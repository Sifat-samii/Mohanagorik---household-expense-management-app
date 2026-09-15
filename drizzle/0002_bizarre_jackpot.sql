CREATE INDEX `splits_member_idx` ON `expense_splits` (`member_id`);--> statement-breakpoint
CREATE INDEX `expenses_household_status_date_idx` ON `expenses` (`household_id`,`status`,`expense_date`);--> statement-breakpoint
CREATE INDEX `expenses_payer_idx` ON `expenses` (`paid_by_member_id`);--> statement-breakpoint
CREATE INDEX `members_user_status_idx` ON `household_members` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `members_household_status_idx` ON `household_members` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `profiles_email_idx` ON `profiles` (`email`);--> statement-breakpoint
CREATE INDEX `recurring_household_active_due_idx` ON `recurring_expenses` (`household_id`,`active`,`next_due_date`);--> statement-breakpoint
CREATE INDEX `settlements_household_date_idx` ON `settlements` (`household_id`,`settlement_date`);--> statement-breakpoint
CREATE INDEX `settlements_from_idx` ON `settlements` (`from_member_id`);--> statement-breakpoint
CREATE INDEX `settlements_to_idx` ON `settlements` (`to_member_id`);