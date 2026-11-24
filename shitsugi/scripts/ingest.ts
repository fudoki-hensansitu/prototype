// 中央区議会の会議録（本会議・委員会）を発言単位に切って D1 に差分で入れる。
// 入れる先の D1 にまだ無い会議だけを中央区議会のサイトから取り、その分だけ書く。
// 実データは repo に入れない（repo が公開のため）。取得した HTML と SQL は .cache/shitsugi/ に置く。
// GitHub Actions では動かさない（外部のサイトから取るので、手元で人が流す）。
//
//   bun shitsugi/scripts/ingest.ts                       # ローカルの D1 に、まだ無い会議を足す
//   bun shitsugi/scripts/ingest.ts --remote              # 本番の D1 に、まだ無い会議を足す
//   bun shitsugi/scripts/ingest.ts --dry-run             # 何を取り何を書くかだけ出す（取得も書き込みもしない）
//   bun shitsugi/scripts/ingest.ts --from 6              # 令和6年から（既定。毎回、今年までを見る）
//   bun shitsugi/scripts/ingest.ts --refetch r08_yosan20260305   # 入れ済みの会議を取り直し、変わっていれば入れ替える
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const BASE = 'https://www.kugikai.city.chuo.lg.jp';
const CACHE = '.cache/shitsugi';
const FETCH_INTERVAL_MS = 1000;

type Kind = 'plenary' | 'budget' | 'settlement' | 'committee' | 'special' | 'steering';
type SpeakerKind = 'member' | 'chair' | 'official' | 'other';
type Meeting = {
  id: string; title: string; kind: Kind; body_name: string; held_on: string; source_url: string; agenda: string; content_hash: string;
};
type Speech = { meeting_id: string; seq: number; speaker_label: string; speaker_kind: SpeakerKind; member_name: string | null; body: string };
type Member = { surname: string; given: string };

function parseArgs(argv: string[]) {
  const opts = { remote: false, dryRun: false, fromReiwa: 6, refetch: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--remote') opts.remote = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--from') opts.fromReiwa = Number(argv[++i]);
    else if (a === '--refetch') opts.refetch.push(argv[++i]);
    else throw new Error(`知らない引数: ${a}`);
  }
  if (!Number.isInteger(opts.fromReiwa) || opts.fromReiwa < 1) throw new Error('--from は令和の年（6 など）');
  return opts;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---- D1 ----

function voidExecute(args: string[], remote: boolean): string {
  const cmd = ['bunx', 'void', 'db', 'execute', ...(remote ? ['--remote'] : []), ...args];
  const p = Bun.spawnSync(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const out = p.stdout.toString();
  if (p.exitCode !== 0) throw new Error(`${cmd.join(' ')} が失敗: ${p.stderr.toString()}${out}`);
  return out;
}

// void db execute は表を整形して出すだけなので、1行1語の印（@@...）にして読み取る。値に空白は入らない。
function selectTokens(sql: string, remote: boolean): string[][] {
  const out = voidExecute([sql], remote);
  return [...out.matchAll(/@@(\S+)/g)].map((m) => m[1].split('|'));
}

function readState(remote: boolean) {
  const meetings = new Map<string, string>();
  for (const [id, hash] of selectTokens(`SELECT '@@' || id || '|' || content_hash AS k FROM meetings`, remote)) meetings.set(id, hash ?? '');
  const members = new Map<string, Member>();
  for (const [name, surname, given] of selectTokens(`SELECT '@@' || name || '|' || surname || '|' || given AS k FROM members`, remote)) {
    members.set(name, { surname, given });
  }
  return { meetings, members };
}

// ---- 中央区議会のサイト ----

// 会議録検索の「年」の値は令和の年 + 30（38 = 令和8）
function reiwaYears(from: number): number[] {
  const now = new Date();
  const current = now.getFullYear() - 2018;
  const ys: number[] = [];
  for (let y = from; y <= current; y++) ys.push(y + 30);
  return ys;
}

async function listPaths(years: number[]): Promise<string[]> {
  const paths = new Set<string>();
  for (const y of years) {
    const res = await fetch(`${BASE}/kaigiroku/index.cgi`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ term: 'date', sel_year: String(y), sort_day: 'desc', searchlist: '検索' }),
    });
    if (!res.ok) throw new Error(`一覧 ${y}: ${res.status}`);
    const html = await res.text();
    for (const m of html.matchAll(/kaigiroku\.cgi\/(r\d+\/[A-Za-z0-9_-]+)\.html/g)) {
      if (!/mokuji|rijisya/.test(m[1])) paths.add(m[1]);
    }
    await sleep(FETCH_INTERVAL_MS);
  }
  return [...paths].sort();
}

const idOf = (path: string) => path.replace('/', '_');
const pathOf = (id: string) => id.replace('_', '/');

// 取り直すとき以外は、手元に保存した HTML があればサイトへは行かない
async function fetchMeeting(path: string, force: boolean): Promise<string> {
  const file = `${CACHE}/raw/${idOf(path)}.html`;
  if (!force && existsSync(file)) return readFile(file, 'utf8');
  const res = await fetch(`${BASE}/kaigiroku.cgi/${path}.html`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const html = await res.text();
  await writeFile(file, html);
  await sleep(FETCH_INTERVAL_MS);
  return html;
}

// ---- 会議録を発言に切る ----

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'" };
function toLines(html: string): string[] {
  let t = html.split('ここから本文です')[1] ?? html;
  t = t.split('お問い合わせ先')[0].split('<script')[0];
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n');
  // 入れ子の「<scr<b>ipt>」のような崩れた印も残さないよう、タグが無くなるまで外す。ここで作るのは表示用の HTML ではなく本文の文字
  for (let prev = ''; prev !== t; ) { prev = t; t = t.replace(/<[^>]*>/g, ''); }
  t = t.replace(/&(#?\w+);/g, (_, e) => ENT[e] ?? (e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : _));
  return t.split('\n').map((l) => l.trim()).filter(Boolean);
}

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
function rosterOf(lines: string[]): Map<string, Member> {
  const found = new Map<string, Member>();
  for (const l of lines) {
    const m = l.match(/^[一二三四五六七八九十]+番[\s　]+(\S+)[\s　]+(\S+?)議員$/);
    if (m) found.set(m[1] + m[2], { surname: m[1], given: m[2] });
  }
  return found;
}

// 姓（と委員会の「高橋（ま）」の名の頭）で名簿から1人に決まるときだけ名前を返す。決まらなければ null
function resolveMember(members: Map<string, Member>, base: string, hint: string | null, attendees: string[]): string | null {
  const cands = [...members.entries()].filter(([, v]) => v.surname === base && (!hint || v.given.startsWith(hint)));
  if (cands.length === 1) return cands[0][0];
  const inRoom = cands.filter(([k]) => attendees.includes(k));
  return inRoom.length === 1 ? inRoom[0][0] : null;
}

function classify(label: string, members: Map<string, Member>, attendees: string[]): { speaker_kind: SpeakerKind; member_name: string | null } {
  // 本会議: 一番（ほづみゆうき議員）・議長（瓜生正高議員）
  const p = label.match(/^(.+?)（(.+?)議員）$/);
  if (p) return { speaker_kind: /議長$/.test(p[1]) ? 'chair' : 'member', member_name: members.has(p[2]) ? p[2] : null };
  // 本会議の理事者: 区長（山本泰人君）
  if (/^(.+?)（.+?(君|さん)）$/.test(label)) return { speaker_kind: 'official', member_name: null };
  // 委員会: ほづみ委員・高橋（ま）委員・田中（広）委員長
  const c = label.match(/^([^（]{1,5}?)(?:（(.)）)?(前|副)?委員(長)?(?:（.*）)?$/);
  if (c && !/教育|選挙|監査/.test(c[1])) {
    const isChair = Boolean(c[4]) && !c[3];
    return { speaker_kind: isChair ? 'chair' : 'member', member_name: resolveMember(members, c[1], c[2] ?? null, attendees) };
  }
  // 本会議の「奥村議員」（番号の無い呼び方）
  const g = label.match(/^([^（]{1,5})議員$/);
  if (g) return { speaker_kind: 'member', member_name: resolveMember(members, g[1], null, attendees) };
  if (/(議長|副議長)$/.test(label)) return { speaker_kind: 'chair', member_name: null };
  // 委員会の理事者: 平川地域振興課長・植木地域福祉課長（参事）
  return { speaker_kind: /長|参事|所長|管理者|教育長|区長/.test(label) ? 'official' : 'other', member_name: null };
}

function parse(path: string, html: string, members: Map<string, Member>): { meeting: Meeting; speeches: Speech[] } {
  const lines = toLines(html);
  const title = lines[0].replace(/[\s　]+/g, ' ');
  const { kind, body_name } = kindOf(path, title);
  const first = lines.findIndex((l) => l.startsWith('○'));
  const head = first === -1 ? lines : lines.slice(0, first);
  const agendaStart = head.findIndex((l) => /^[0-9０-９]+．(議題|議事日程)/.test(l));
  const agenda = agendaStart === -1 ? '' : head.slice(agendaStart + 1).filter((l) => !/^（.*）$/.test(l)).join('\n');
  // 委員会の出席者「委員　ほづみ　ゆうき」
  const attendees = head
    .map((l) => l.match(/^(?:委員長|副委員長|委員|議長|副議長)[\s　]+(\S+)[\s　]+(\S+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => m[1] + m[2]);
  const id = idOf(path);
  const meeting: Meeting = {
    id, title, kind, body_name, held_on: heldOn(title, path), source_url: `${BASE}/kaigiroku.cgi/${path}.html`, agenda, content_hash: sha(html),
  };

  const speeches: Speech[] = [];
  if (first !== -1) {
    let cur: { label: string; body: string[] } | null = null;
    const flush = () => {
      if (!cur) return;
      const body = cur.body.filter((l) => !/^（.+）$/.test(l)).join('\n');
      speeches.push({ meeting_id: id, seq: speeches.length + 1, speaker_label: cur.label, ...classify(cur.label, members, attendees), body });
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

// ---- SQL ----

const q = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);

// 会議の行は発言の後に書く。途中で止まっても会議の行が無ければ次の回にその会議を取り直し、
// 先頭の DELETE が書きかけの発言を消す（消す行が無ければ書き込みにならない）。
function insertSql(m: Meeting, speeches: Speech[]): string[] {
  const out = [`DELETE FROM speeches WHERE meeting_id = ${q(m.id)};`];
  for (const s of speeches) {
    out.push(`INSERT INTO speeches (meeting_id, seq, speaker_label, speaker_kind, member_name, body) VALUES (${
      [s.meeting_id, s.seq, s.speaker_label, s.speaker_kind, s.member_name, s.body].map(q).join(', ')
    });`);
  }
  out.push(`INSERT INTO meetings (id, title, kind, body_name, held_on, source_url, agenda, content_hash) VALUES (${
    [m.id, m.title, m.kind, m.body_name, m.held_on, m.source_url, m.agenda, m.content_hash].map(q).join(', ')
  });`);
  return out;
}

// ---- main ----

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const target = opts.remote ? '本番の D1' : 'ローカルの D1';
  await mkdir(`${CACHE}/raw`, { recursive: true });

  const state = readState(opts.remote);
  const listed = await listPaths(reiwaYears(opts.fromReiwa));
  for (const id of opts.refetch) if (!state.meetings.has(id)) throw new Error(`--refetch ${id} は ${target} にまだ無い`);
  const added = listed.filter((p) => !state.meetings.has(idOf(p)));
  const refetch = opts.refetch.map(pathOf);
  console.error(`${target}: 入れ済み ${state.meetings.size} 会議。サイトの一覧 ${listed.length} 会議のうち、新しい会議 ${added.length}、取り直し ${refetch.length}`);
  if (opts.dryRun) {
    for (const p of added) console.error(`  + ${idOf(p)}`);
    for (const p of refetch) console.error(`  ~ ${idOf(p)}`);
    return;
  }
  if (added.length === 0 && refetch.length === 0) {
    console.error('差分なし。何も書かない');
    return;
  }

  const htmls = new Map<string, { html: string; replace: boolean }>();
  for (const p of added) htmls.set(p, { html: await fetchMeeting(p, false), replace: false });
  for (const p of refetch) htmls.set(p, { html: await fetchMeeting(p, true), replace: true });

  // 名簿は D1 に入れ済みの議員に、今回取った本会議の出席議員を足したもの
  const members = new Map(state.members);
  const newMembers = new Map<string, Member>();
  for (const { html } of htmls.values()) {
    for (const [name, v] of rosterOf(toLines(html))) if (!members.has(name)) { members.set(name, v); newMembers.set(name, v); }
  }

  const out: string[] = [];
  for (const [name, v] of newMembers) out.push(`INSERT OR IGNORE INTO members (name, surname, given) VALUES (${q(name)}, ${q(v.surname)}, ${q(v.given)});`);
  let meetings = 0;
  let speeches = 0;
  let unresolved = 0;
  let unchanged = 0;
  for (const [p, { html, replace }] of htmls) {
    const parsed = parse(p, html, members);
    if (replace) {
      if (state.meetings.get(parsed.meeting.id) === parsed.meeting.content_hash) { unchanged++; continue; }
      out.push(`DELETE FROM meetings WHERE id = ${q(parsed.meeting.id)};`);
    }
    out.push(...insertSql(parsed.meeting, parsed.speeches));
    meetings++;
    speeches += parsed.speeches.length;
    unresolved += parsed.speeches.filter((s) => s.speaker_kind === 'member' && !s.member_name).length;
  }
  if (out.length === 0) {
    console.error(`取り直した ${unchanged} 会議はどれも変わっていない。何も書かない`);
    return;
  }

  const file = `${CACHE}/diff.sql`;
  await writeFile(file, out.join('\n') + '\n');
  voidExecute(['--file', file], opts.remote);
  console.error(
    `${target} に書いた: 会議 ${meetings}、発言 ${speeches}、議員 ${newMembers.size}（変わらず飛ばした取り直し ${unchanged}、議員の発言で名前が決まらなかったもの ${unresolved}）`,
  );
}

await main();
