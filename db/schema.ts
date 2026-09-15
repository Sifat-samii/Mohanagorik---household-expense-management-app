import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const households = sqliteTable("households", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("BDT"),
  inviteCode: text("invite_code").notNull().unique(),
  ownerId: text("owner_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const householdMembers = sqliteTable("household_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  householdId: text("household_id").notNull(),
  userId: text("user_id").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("member"),
  avatarChoice: text("avatar_choice").notNull().default("indigo"),
  avatarKey: text("avatar_key"),
  status: text("status").notNull().default("active"),
  joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("member_household_user_unique").on(table.householdId, table.userId)]);

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paidByMemberId: integer("paid_by_member_id").notNull(),
  expenseDate: text("expense_date").notNull(),
  splitType: text("split_type").notNull().default("equal"),
  notes: text("notes").notNull().default(""),
  receiptKey: text("receipt_key"),
  status: text("status").notNull().default("active"),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const expenseSplits = sqliteTable("expense_splits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  expenseId: text("expense_id").notNull(),
  memberId: integer("member_id").notNull(),
  shareCents: integer("share_cents").notNull(),
}, (table) => [uniqueIndex("split_expense_member_unique").on(table.expenseId, table.memberId)]);

export const settlements = sqliteTable("settlements", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  fromMemberId: integer("from_member_id").notNull(),
  toMemberId: integer("to_member_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  settlementDate: text("settlement_date").notNull(),
  notes: text("notes").notNull().default(""),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const recurringExpenses = sqliteTable("recurring_expenses", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paidByMemberId: integer("paid_by_member_id").notNull(),
  cadence: text("cadence").notNull().default("monthly"),
  nextDueDate: text("next_due_date").notNull(),
  participantIds: text("participant_ids").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastPostedAt: text("last_posted_at"),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
