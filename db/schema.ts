// shitsugi（中央区議会の質疑）の表。中身は shitsugi/scripts/ingest.ts が作る SQL で入れ、repo には入れない。
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
    memberName: text('member_name'),
    officialRole: text('official_role'),
    topic: text('topic'), // 予算・決算特別委員会の款（区民費など）
    exchangeSeq: integer('exchange_seq'), // 問いを始めた議員の発言の seq。答弁はその問いの seq を持つ
    body: text('body').notNull(),
  },
  (t) => [index('speeches_meeting').on(t.meetingId, t.seq), index('speeches_member').on(t.memberName)],
);
