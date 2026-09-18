CREATE TABLE `household_creation_cooldowns` (
	`user_id` text PRIMARY KEY NOT NULL,
	`locked_until` text NOT NULL
);
