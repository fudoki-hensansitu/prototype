// shitsugi（中央区議会の質疑）の表。中身は shitsugi/scripts/ingest.ts が差分で入れ、repo には入れない。
// 推定でしか決まらない項目（問いと答えの対応・款・理事者の役職）は持たない。
import { index, integer, sqliteTable, text } from 'void/schema-d1';

export const members = sqliteTable('members', {
  name: text('name').primaryKey(), // ほづみゆうき
  surname: text('surname').notNull(),
  given: text('given').notNull(),
});

export const meetings = sqliteTable(
  'meetings',
  {
    id: text('id').primaryKey(), // r07_kessan20251001
    title: text('title').notNull(),
    // plenary（本会議）・budget（予算特別）・settlement（決算特別）・committee（常任）・special（特別）・steering（議会運営）
    kind: text('kind').notNull(),
    bodyName: text('body_name').notNull(),
    heldOn: text('held_on').notNull(),
    sourceUrl: text('source_url').notNull(),
    agenda: text('agenda').notNull(),
    contentHash: text('content_hash').notNull().default(''), // 本文の HTML の sha256 の先頭16桁。取り直したとき変わったかを見る（差分化より前の行は空）
  },
  (t) => [index('meetings_held_on').on(t.heldOn)],
);

export const speeches = sqliteTable(
  'speeches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    meetingId: text('meeting_id').notNull(),
    seq: integer('seq').notNull(),
    speakerLabel: text('speaker_label').notNull(), // 会議録の「○」の後ろの印字のまま
    speakerKind: text('speaker_kind').notNull(), // member・chair・official・other
    memberName: text('member_name'), // 議員の名簿で1人に決まったときだけ。決まらなければ NULL
    body: text('body').notNull(),
  },
  (t) => [index('speeches_meeting').on(t.meetingId, t.seq), index('speeches_member').on(t.memberName)],
);
