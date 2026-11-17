// 中央区議会の会議録（本会議・委員会）を取り、発言単位に切って D1 に入れる SQL を書き出す。
// 実データは repo に入れない（repo が公開のため）。取得した HTML と SQL は .cache/shitsugi/ に置く。
//
//   bun shitsugi/scripts/ingest.ts            # R6〜R8 を取り、.cache/shitsugi/seed.sql を書く
//   bunx void db execute --file .cache/shitsugi/seed.sql            # ローカルの D1 に入れる
//   bunx void db execute --remote --file .cache/shitsugi/seed.sql   # 本番の D1 に入れる
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const BASE = 'https://www.kugikai.city.chuo.lg.jp';
const CACHE = '.cache/shitsugi';
// 会議録検索の「年」の値。38 = 令和8
const YEARS = [36, 37, 38];

type Kind = 'plenary' | 'budget' | 'settlement' | 'committee' | 'special' | 'steering';
type Meeting = { id: string; title: string; kind: Kind; body_name: string; held_on: string; source_url: string; agenda: string };
type Speech = {
  meeting_id: string; seq: number; speaker_label: string; speaker_kind: 'member' | 'chair' | 'official' | 'other';
  member_name: string | null; official_role: string | null; topic: string | null; exchange_seq: number | null; body: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listUrls(): Promise<string[]> {
  const urls = new Set<string>();
  for (const y of YEARS) {
    const res = await fetch(`${BASE}/kaigiroku/index.cgi`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ term: 'date', sel_year: String(y), sort_day: 'desc', searchlist: '検索' }),
    });
    const html = await res.text();
    for (const m of html.matchAll(/kaigiroku\.cgi\/(r\d+\/[A-Za-z0-9_-]+)\.html/g)) {
      if (!/mokuji|rijisya/.test(m[1])) urls.add(m[1]);
    }
  }
  return [...urls].sort();
}

async function fetchCached(path: string): Promise<string> {
  const file = `${CACHE}/raw/${path.replace('/', '_')}.html`;
  if (existsSync(file)) return readFile(file, 'utf8');
  const res = await fetch(`${BASE}/kaigiroku.cgi/${path}.html`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const html = await res.text();
  await writeFile(file, html);
  await sleep(300);
  return html;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'" };
function toLines(html: string): string[] {
  let t = html.split('ここから本文です')[1] ?? html;
  t = t.split('お問い合わせ先')[0].split('<script')[0];
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, '');
  t = t.replace(/&(#?\w+);/g, (_, e) => ENT[e] ?? (e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : _));
  return t.split('\n').map((l) => l.trim()).filter(Boolean);
}

const KANJI_NUM: Record<string, number> = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function heldOn(title: string, path: string): string {
  const fromPath = path.match(/(20\d{2})(\d{2})(\d{2})/);
  if (fromPath) return `${fromPath[1]}-${fromPath[2]}-${fromPath[3]}`;
  const z = title.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const y = z.match(/令和(\d+)年/);
  const md = z.match(/(\d+)月\s*(\d+)日/);
  if (!y || !md) throw new Error(`日付が読めない: ${title}`);
  return `${2018 + Number(y[1])}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
}

function kindOf(path: string, title: string): { kind: Kind; body_name: string } {
  const name = path.split('/')[1].replace(/[\d-]+$/, '');
  if (name === 'teireikai' || name === 'rinjikai') return { kind: 'plenary', body_name: '本会議' };
  if (name === 'yosan') return { kind: 'budget', body_name: '予算特別委員会' };
  if (name === 'kessan') return { kind: 'settlement', body_name: '決算特別委員会' };
  if (name === 'gikaiunei') return { kind: 'steering', body_name: '議会運営委員会' };
  const m = title.match(/[\s　]([^\s　(（]+委員会)/);
  const body_name = m ? m[1] : name;
  return { kind: body_name.includes('特別委員会') ? 'special' : 'committee', body_name };
}

// 本会議の出席議員「一番　ほづみ　ゆうき議員」から議員の名簿を作る
const members = new Map<string, { surname: string; given: string }>();
const officialSurnames = new Set<string>();
function collectRoster(lines: string[]) {
  for (const l of lines) {
    const m = l.match(/^[一二三四五六七八九十]+番[\s　]+(\S+)[\s　]+(\S+?)議員$/);
    if (m) members.set(m[1] + m[2], { surname: m[1], given: m[2] });
    const o = l.match(/^\S+[\s　]+(\S+)[\s　]+\S+君$/);
    if (o) officialSurnames.add(o[1]);
  }
}

function resolveMember(base: string, hint: string | null, attendees: string[]): string | null {
  const cands = [...members.entries()].filter(([, v]) => v.surname === base && (!hint || v.given.startsWith(hint)));
  if (cands.length === 1) return cands[0][0];
  const inRoom = cands.filter(([k]) => attendees.includes(k));
  return inRoom.length === 1 ? inRoom[0][0] : null;
}

function classify(label: string, attendees: string[]): Pick<Speech, 'speaker_kind' | 'member_name' | 'official_role'> {
  // 本会議: 一番（ほづみゆうき議員）・議長（瓜生正高議員）
  const p = label.match(/^(.+?)（(.+?)議員）$/);
  if (p) {
    const name = p[2];
    return { speaker_kind: /議長$/.test(p[1]) ? 'chair' : 'member', member_name: members.has(name) ? name : null, official_role: null };
  }
  // 本会議の理事者: 区長（山本泰人君）
  const o = label.match(/^(.+?)（.+?(君|さん)）$/);
  if (o) return { speaker_kind: 'official', member_name: null, official_role: o[1] };
  // 委員会: ほづみ委員・高橋（ま）委員・田中（広）委員長
  const c = label.match(/^([^（]{1,5}?)(?:（(.)）)?(前|副)?委員(長)?(?:（.*）)?$/);
  if (c && !/教育|選挙|監査/.test(c[1])) {
    const isChair = Boolean(c[4]) && !c[3];
    return { speaker_kind: isChair ? 'chair' : 'member', member_name: resolveMember(c[1], c[2] ?? null, attendees), official_role: null };
  }
  // 本会議の「奥村議員」（番号の無い呼び方）
  const g = label.match(/^([^（]{1,5})議員$/);
  if (g) return { speaker_kind: 'member', member_name: resolveMember(g[1], null, attendees), official_role: null };
  const chairOnly = label.match(/^(.+?)(議長|副議長)$/);
  if (chairOnly) return { speaker_kind: 'chair', member_name: null, official_role: null };
  // 委員会の理事者: 平川地域振興課長・植木地域福祉課長（参事）
  const sur = [...officialSurnames].filter((s) => label.startsWith(s)).sort((a, b) => b.length - a.length)[0];
  const role = sur ? label.slice(sur.length) : label.slice(2);
  return { speaker_kind: /長|参事|所長|管理者|教育長|区長/.test(label) ? 'official' : 'other', member_name: null, official_role: role || null };
}

function parse(path: string, html: string): { meeting: Meeting; speeches: Speech[] } {
  const lines = toLines(html);
  const title = lines[0].replace(/[\s　]+/g, ' ');
  const { kind, body_name } = kindOf(path, title);
  const first = lines.findIndex((l) => l.startsWith('○'));
  const head = first === -1 ? lines : lines.slice(0, first);
  const agendaStart = head.findIndex((l) => /^[6６]．(議題|議事日程)/.test(l));
  const agenda = agendaStart === -1 ? '' : head.slice(agendaStart + 1).filter((l) => !/^（.*）$/.test(l)).join('\n');
  // 委員会の出席者「委員　ほづみ　ゆうき」
  const attendees = head
    .map((l) => l.match(/^(?:委員長|副委員長|委員|議長|副議長)[\s　]+(\S+)[\s　]+(\S+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => m[1] + m[2]);
  const meeting: Meeting = { id: path.replace('/', '_'), title, kind, body_name, held_on: heldOn(title, path), source_url: `${BASE}/kaigiroku.cgi/${path}.html`, agenda };

  const speeches: Speech[] = [];
  let topic: string | null = null;
  let exchange: number | null = null;
  if (first !== -1) {
    let cur: { label: string; body: string[] } | null = null;
    const flush = () => {
      if (!cur) return;
      const body = cur.body.filter((l) => !/^（.+）$/.test(l)).join('\n');
      const who = classify(cur.label, attendees);
      const seq = speeches.length + 1;
      if (who.speaker_kind === 'chair') {
        const kan = body.match(/第[０-９\d]+款「(.+?)」/);
        if (kan) topic = kan[1];
        else if (/歳入/.test(body) && /質問者の発言/.test(body)) topic = '歳入';
      }
      if (who.speaker_kind === 'member') exchange = seq;
      speeches.push({ meeting_id: meeting.id, seq, speaker_label: cur.label, ...who, topic, exchange_seq: who.speaker_kind === 'chair' ? null : exchange, body });
    };
    for (const l of lines.slice(first)) {
      if (l.startsWith('○')) {
        flush();
        const rest = l.slice(1).replace(/\(/g, '（').replace(/\)/g, '）');
        // 「十四番（太田　太議員）」のように括弧の中に空白があるときは、閉じ括弧までを名前にする
        const m = rest.match(/^([^\s　（]*（[^）]*）\S*?|\S+?)(?:[\s　]+(.*))?$/);
        cur = { label: (m?.[1] ?? rest).replace(/[\s　]/g, ''), body: m?.[2] ? [m[2]] : [] };
      } else cur?.body.push(l);
    }
    flush();
  }
  return { meeting, speeches };
}

const q = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);

async function main() {
  await mkdir(`${CACHE}/raw`, { recursive: true });
  const paths = await listUrls();
  console.error(`会議 ${paths.length} 件`);
  const htmls = new Map<string, string>();
  for (const p of paths) htmls.set(p, await fetchCached(p));
  for (const html of htmls.values()) collectRoster(toLines(html));
  const out: string[] = ['DELETE FROM speeches;', 'DELETE FROM meetings;', 'DELETE FROM members;'];
  for (const [name, v] of members) out.push(`INSERT INTO members (name, surname, given) VALUES (${q(name)}, ${q(v.surname)}, ${q(v.given)});`);
  let n = 0;
  let unresolved = 0;
  for (const [p, html] of htmls) {
    const { meeting: m, speeches } = parse(p, html);
    out.push(`INSERT INTO meetings (id, title, kind, body_name, held_on, source_url, agenda) VALUES (${[m.id, m.title, m.kind, m.body_name, m.held_on, m.source_url, m.agenda].map(q).join(', ')});`);
    for (const s of speeches) {
      if (s.speaker_kind === 'member' && !s.member_name) unresolved++;
      out.push(`INSERT INTO speeches (meeting_id, seq, speaker_label, speaker_kind, member_name, official_role, topic, exchange_seq, body) VALUES (${[s.meeting_id, s.seq, s.speaker_label, s.speaker_kind, s.member_name, s.official_role, s.topic, s.exchange_seq, s.body].map(q).join(', ')});`);
      n++;
    }
  }
  await writeFile(`${CACHE}/seed.sql`, out.join('\n') + '\n');
  console.error(`議員 ${members.size} 人、発言 ${n} 件（議員の発言で名前を解決できなかったもの ${unresolved} 件）→ ${CACHE}/seed.sql`);
}

await main();
