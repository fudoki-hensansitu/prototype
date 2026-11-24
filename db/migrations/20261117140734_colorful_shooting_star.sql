CREATE TABLE `meetings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`body_name` text NOT NULL,
	`held_on` text NOT NULL,
	`source_url` text NOT NULL,
	`agenda` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meetings_held_on` ON `meetings` (`held_on`);--> statement-breakpoint
CREATE TABLE `members` (
	`name` text PRIMARY KEY NOT NULL,
	`surname` text NOT NULL,
	`given` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `speeches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meeting_id` text NOT NULL,
	`seq` integer NOT NULL,
	`speaker_label` text NOT NULL,
	`speaker_kind` text NOT NULL,
	`member_name` text,
	`official_role` text,
	`topic` text,
	`exchange_seq` integer,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `speeches_meeting` ON `speeches` (`meeting_id`,`seq`);--> statement-breakpoint
CREATE INDEX `speeches_member` ON `speeches` (`member_name`);