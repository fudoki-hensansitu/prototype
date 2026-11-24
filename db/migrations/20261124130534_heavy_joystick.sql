ALTER TABLE `meetings` ADD `content_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `speeches` DROP COLUMN `official_role`;--> statement-breakpoint
ALTER TABLE `speeches` DROP COLUMN `topic`;--> statement-breakpoint
ALTER TABLE `speeches` DROP COLUMN `exchange_seq`;