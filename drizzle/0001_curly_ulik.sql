ALTER TABLE `household_members` ADD `avatar_choice` text DEFAULT 'indigo' NOT NULL;--> statement-breakpoint
ALTER TABLE `household_members` ADD `avatar_key` text;--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `last_posted_at` text;