import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
import { addMonthsClamped, calculateBalances, simplifySettlements, splitEqually } from "@/lib/domain";
import { EXPENSE_CATEGORIES, isCategoryApplicable, normalizeApplicableCategories } from "@/lib/categories";
import { apiJson, guardMutationOrigin, guardRateLimit, logServerError } from "@/lib/http";
import { getGoogleUser } from "../../google-auth";

type Row = Record<string, string | number | null>;

const json = apiJson;
const MAX_AMOUNT_CENTS = 10_000_000_000;
const money = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && cents <= MAX_AMOUNT_CENTS ? cents : 0;
};
const textValue = (value: unknown, max = 120) => String(value ?? "").trim().slice(0, max);
const validDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && year <= 2100 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const serverToday = () => new Date().toISOString().slice(0, 10);
const requestToday = (request: Request) => {
  const candidate = request.headers.get("x-client-date") ?? "";
  if (!validDate(candidate)) return serverToday();
  const distance = Math.abs(Date.parse(`${candidate}T00:00:00Z`) - Date.parse(`${serverToday()}T00:00:00Z`));
  return distance <= 36 * 60 * 60 * 1000 ? candidate : serverToday();
};

function inviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

async function currentUser() {
  return getGoogleUser();
}

async function membership(householdId: string, userId: string) {
  return env.DB!.prepare(`SELECT id, household_id, user_id, display_name, avatar_choice, avatar_key, applicable_categories FROM household_members
    WHERE household_id = ? AND user_id = ? AND status = 'active'`)
    .bind(householdId, userId).first<Row>();
}

async function householdPayload(householdId: string, userId: string, selectedMonth: string) {
  const db = env.DB!;
  const member = await membership(householdId, userId);
  if (!member) throw new Error("Household access denied");

  const [home, members, expenses, monthlyExpenses, splits, monthlySplits, settlements, recurring, paidTotals, owedTotals, settlementTotals, monthlyPaidTotals, monthlySettlementOutgoing, monthlySettlementIncoming] = await Promise.all([
    db.prepare(`SELECT id, name, currency, invite_code FROM households WHERE id = ?`).bind(householdId).first<Row>(),
    db.prepare(`SELECT id, user_id, display_name, avatar_choice, avatar_key, applicable_categories, joined_at FROM household_members WHERE household_id = ? AND status = 'active' ORDER BY joined_at`).bind(householdId).all<Row>(),
    db.prepare(`SELECT e.id, e.description, e.category, e.amount_cents, e.paid_by_member_id, e.expense_date,
      e.split_type, e.notes, e.receipt_key, e.created_at, m.display_name AS payer_name
      FROM expenses e JOIN household_members m ON m.id = e.paid_by_member_id
      WHERE e.household_id = ? AND e.status = 'active' AND LOWER(e.category) <> 'rent' ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 250`).bind(householdId).all<Row>(),
    db.prepare(`SELECT e.id, e.description, e.category, e.amount_cents, e.paid_by_member_id, e.expense_date,
      e.split_type, e.notes, e.receipt_key, e.created_at, m.display_name AS payer_name
      FROM expenses e JOIN household_members m ON m.id = e.paid_by_member_id
      WHERE e.household_id = ? AND e.status = 'active' AND LOWER(e.category) <> 'rent' AND substr(e.expense_date, 1, 7) = ?
      ORDER BY e.expense_date DESC, e.created_at DESC`).bind(householdId, selectedMonth).all<Row>(),
    db.prepare(`SELECT s.expense_id, s.member_id, s.share_cents FROM expense_splits s
      JOIN (SELECT id FROM expenses WHERE household_id = ? AND status = 'active' AND LOWER(category) <> 'rent'
        ORDER BY expense_date DESC, created_at DESC LIMIT 250) e ON e.id = s.expense_id`).bind(householdId).all<Row>(),
    db.prepare(`SELECT s.expense_id, s.member_id, s.share_cents FROM expense_splits s
      JOIN expenses e ON e.id = s.expense_id WHERE e.household_id = ? AND e.status = 'active'
      AND LOWER(e.category) <> 'rent' AND substr(e.expense_date, 1, 7) = ?`).bind(householdId, selectedMonth).all<Row>(),
    db.prepare(`SELECT s.id, s.from_member_id, s.to_member_id, s.amount_cents, s.settlement_date, s.notes,
      fm.display_name AS from_name, tm.display_name AS to_name
      FROM settlements s JOIN household_members fm ON fm.id = s.from_member_id
      JOIN household_members tm ON tm.id = s.to_member_id WHERE s.household_id = ?
      ORDER BY s.settlement_date DESC, s.created_at DESC LIMIT 150`).bind(householdId).all<Row>(),
    db.prepare(`SELECT r.*, m.display_name AS payer_name FROM recurring_expenses r
      JOIN household_members m ON m.id = r.paid_by_member_id WHERE r.household_id = ? AND r.active = 1 AND LOWER(r.category) <> 'rent'
      ORDER BY r.next_due_date`).bind(householdId).all<Row>(),
    db.prepare(`SELECT paid_by_member_id AS member_id, SUM(amount_cents) AS amount_cents FROM expenses
      WHERE household_id = ? AND status = 'active' AND LOWER(category) <> 'rent' GROUP BY paid_by_member_id`).bind(householdId).all<Row>(),
    db.prepare(`SELECT s.member_id, SUM(s.share_cents) AS amount_cents FROM expense_splits s
      JOIN expenses e ON e.id = s.expense_id WHERE e.household_id = ? AND e.status = 'active' AND LOWER(e.category) <> 'rent'
      GROUP BY s.member_id`).bind(householdId).all<Row>(),
    db.prepare(`SELECT from_member_id, to_member_id, amount_cents FROM settlements WHERE household_id = ?`).bind(householdId).all<Row>(),
    db.prepare(`SELECT paid_by_member_id AS member_id, SUM(amount_cents) AS amount_cents FROM expenses
      WHERE household_id = ? AND status = 'active' AND LOWER(category) <> 'rent' AND substr(expense_date, 1, 7) = ?
      GROUP BY paid_by_member_id`).bind(householdId, selectedMonth).all<Row>(),
    db.prepare(`SELECT from_member_id AS member_id, SUM(amount_cents) AS amount_cents FROM settlements
      WHERE household_id = ? AND substr(settlement_date, 1, 7) = ? GROUP BY from_member_id`).bind(householdId, selectedMonth).all<Row>(),
    db.prepare(`SELECT to_member_id AS member_id, SUM(amount_cents) AS amount_cents FROM settlements
      WHERE household_id = ? AND substr(settlement_date, 1, 7) = ? GROUP BY to_member_id`).bind(householdId, selectedMonth).all<Row>(),
  ]);

  const balanceRows = calculateBalances(members.results.map((m) => ({
    memberId: Number(m.id),
    name: String(m.display_name),
    isCurrentUser: m.user_id === userId,
  })), paidTotals.results.map((row) => ({ memberId: Number(row.member_id), amountCents: Number(row.amount_cents) })),
  owedTotals.results.map((row) => ({ memberId: Number(row.member_id), amountCents: Number(row.amount_cents) })),
  settlementTotals.results.map((row) => ({ fromMemberId: Number(row.from_member_id), toMemberId: Number(row.to_member_id), amountCents: Number(row.amount_cents) })));
  const suggestedSettlements = simplifySettlements(balanceRows);

  const categoryMap = new Map<string, number>();
  let monthTotalCents = 0;
  for (const e of monthlyExpenses.results) {
    monthTotalCents += Number(e.amount_cents);
    const category = String(e.category);
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + Number(e.amount_cents));
  }
  const categories = [...categoryMap].map(([name, amountCents]) => ({ name, amountCents })).sort((a, b) => b.amountCents - a.amountCents);
  const expensePaidByMember = new Map(monthlyPaidTotals.results.map((row) => [Number(row.member_id), Number(row.amount_cents)]));
  const settlementOutgoingByMember = new Map(monthlySettlementOutgoing.results.map((row) => [Number(row.member_id), Number(row.amount_cents)]));
  const settlementIncomingByMember = new Map(monthlySettlementIncoming.results.map((row) => [Number(row.member_id), Number(row.amount_cents)]));
  const memberSpending = members.results.map((row) => ({
    memberId: Number(row.id),
    name: String(row.display_name),
    expenseAmountCents: expensePaidByMember.get(Number(row.id)) ?? 0,
    settlementAmountCents: (settlementOutgoingByMember.get(Number(row.id)) ?? 0) - (settlementIncomingByMember.get(Number(row.id)) ?? 0),
    amountCents: (expensePaidByMember.get(Number(row.id)) ?? 0) + (settlementOutgoingByMember.get(Number(row.id)) ?? 0) - (settlementIncomingByMember.get(Number(row.id)) ?? 0),
  })).sort((a, b) => b.amountCents - a.amountCents);
  const enrichedExpenses = expenses.results.map((e) => ({
    ...e,
    splits: splits.results.filter((s) => s.expense_id === e.id),
  }));
  const enrichedMonthlyExpenses = monthlyExpenses.results.map((e) => ({
    ...e,
    splits: monthlySplits.results.filter((s) => s.expense_id === e.id),
  }));
  const publicMembers = members.results.map((row) => ({
    id: row.id,
    display_name: row.display_name,
    avatar_choice: row.avatar_choice,
    avatar_key: row.avatar_key,
    applicable_categories: row.applicable_categories,
    joined_at: row.joined_at,
  }));

  return {
    household: home,
    currentMemberId: Number(member.id),
    members: publicMembers,
    expenses: enrichedExpenses,
    settlements: settlements.results,
    recurring: recurring.results,
    balances: balanceRows,
    suggestedSettlements,
    selectedMonth,
    monthlyExpenses: enrichedMonthlyExpenses,
    memberSpending,
    monthTotalCents,
    categories,
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Sign in required" }, 401);
    if (!env.DB) return json({ error: "Service temporarily unavailable" }, 503);
    const homes = await env.DB.prepare(`SELECT h.id, h.name, h.currency, h.invite_code
      FROM households h JOIN household_members hm ON hm.household_id = h.id
      WHERE hm.user_id = ? AND hm.status = 'active' ORDER BY hm.joined_at`).bind(user.userId).all<Row>();
    const requestedHouseholdId = request.nextUrl.searchParams.get("householdId") || "";
    const householdId = homes.results.some((home) => String(home.id) === requestedHouseholdId) ? requestedHouseholdId : String(homes.results[0]?.id ?? "");
    const currentMonth = requestToday(request).slice(0, 7);
    const requestedMonth = request.nextUrl.searchParams.get("month") ?? currentMonth;
    const selectedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) && requestedMonth <= currentMonth ? requestedMonth : currentMonth;
    if (!householdId) return json({ households: homes.results, active: null });
    return json({ households: homes.results, active: await householdPayload(householdId, user.userId, selectedMonth) });
  } catch (error) {
    logServerError(request, error, "load-household");
    return json({ error: "Unable to load MohaNagorik" }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const originError = guardMutationOrigin(request);
    if (originError) return originError;
    const user = await currentUser();
    if (!user) return json({ error: "Sign in required" }, 401);
    if (!env.DB) return json({ error: "Service temporarily unavailable" }, 503);
    const rateLimitError = await guardRateLimit(request, user.userId, "app-write");
    if (rateLimitError) return rateLimitError;
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "Content-Type must be application/json" }, 415);
    const rawBody = await request.text();
    if (rawBody.length > 64 * 1024) return json({ error: "Request is too large" }, 413);
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const action = textValue(body.action, 40);
    const db = env.DB;

    if (action === "create_household") {
      const name = textValue(body.name, 60);
      if (name.length < 2) return json({ error: "Enter a household name" }, 400);
      const currency = textValue(body.currency, 3).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return json({ error: "Choose a valid currency" }, 400);
      const existing = await db.prepare(`SELECT COUNT(*) AS count FROM household_members WHERE user_id = ? AND status = 'active'`).bind(user.userId).first<{count:number}>();
      if (Number(existing?.count) >= 20) return json({ error: "Household limit reached" }, 400);
      const lockCreatedAt = new Date().toISOString();
      const lockedUntil = new Date(Date.now() + 10_000).toISOString();
      const creationLock = await db.prepare(`INSERT INTO household_creation_cooldowns (user_id, locked_until) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET locked_until = excluded.locked_until
        WHERE household_creation_cooldowns.locked_until <= ?`).bind(user.userId, lockedUntil, lockCreatedAt).run();
      if (Number(creationLock.meta.changes) !== 1) {
        const response = json({ error: "Please wait 10 seconds before creating another household" }, 429);
        response.headers.set("Retry-After", "10");
        return response;
      }
      const id = crypto.randomUUID();
      const code = inviteCode();
      try {
        await db.batch([
          db.prepare(`INSERT INTO households (id, name, currency, invite_code, owner_id) VALUES (?, ?, ?, ?, ?)`).bind(id, name, currency, code, user.userId),
          db.prepare(`INSERT INTO household_members (household_id, user_id, display_name, role) VALUES (?, ?, ?, 'member')`).bind(id, user.userId, user.displayName),
        ]);
      } catch (createError) {
        try { await db.prepare(`DELETE FROM household_creation_cooldowns WHERE user_id = ? AND locked_until = ?`).bind(user.userId, lockedUntil).run(); }
        catch (unlockError) { logServerError(request, unlockError, "unlock-household-creation-after-failure"); }
        throw createError;
      }
      return json({ ok: true, householdId: id });
    }

    if (action === "join_household") {
      const code = textValue(body.inviteCode, 20).toUpperCase();
      if (!/^[A-Z0-9]{8,20}$/.test(code)) return json({ error: "Enter a valid invite code" }, 400);
      const home = await db.prepare(`SELECT id FROM households WHERE invite_code = ?`).bind(code).first<Row>();
      if (!home) return json({ error: "That invite code was not found" }, 404);
      const existing = await db.prepare(`SELECT COUNT(*) AS count FROM household_members WHERE user_id = ? AND status = 'active'`).bind(user.userId).first<{count:number}>();
      const alreadyMember = await membership(String(home.id), user.userId);
      if (!alreadyMember && Number(existing?.count) >= 20) return json({ error: "Household limit reached" }, 400);
      await db.prepare(`INSERT INTO household_members (household_id, user_id, display_name, role)
        VALUES (?, ?, ?, 'member') ON CONFLICT(household_id, user_id) DO UPDATE SET status = 'active', display_name = excluded.display_name`)
        .bind(home.id, user.userId, user.displayName).run();
      return json({ ok: true, householdId: home.id });
    }

    const householdId = textValue(body.householdId, 80);
    const member = await membership(householdId, user.userId);
    if (!member) return json({ error: "Household access denied" }, 403);

    if (action === "delete_household") {
      if (body.confirmation !== "delete") return json({ error: "Type delete to confirm" }, 400);
      const storedObjects = await db.prepare(`SELECT receipt_key AS object_key FROM expenses
        WHERE household_id = ? AND receipt_key IS NOT NULL
        UNION ALL
        SELECT avatar_key AS object_key FROM household_members
        WHERE household_id = ? AND avatar_key IS NOT NULL`).bind(householdId, householdId).all<{object_key:string}>();
      await db.batch([
        db.prepare(`DELETE FROM expense_splits WHERE expense_id IN (SELECT id FROM expenses WHERE household_id = ?)`).bind(householdId),
        db.prepare(`DELETE FROM expenses WHERE household_id = ?`).bind(householdId),
        db.prepare(`DELETE FROM settlements WHERE household_id = ?`).bind(householdId),
        db.prepare(`DELETE FROM recurring_expenses WHERE household_id = ?`).bind(householdId),
        db.prepare(`DELETE FROM household_members WHERE household_id = ?`).bind(householdId),
        db.prepare(`DELETE FROM households WHERE id = ?`).bind(householdId),
      ]);
      if (env.BUCKET && storedObjects.results.length) {
        const keys = [...new Set(storedObjects.results.map((row) => String(row.object_key)).filter(Boolean))];
        try {
          for (let index = 0; index < keys.length; index += 1000) await env.BUCKET.delete(keys.slice(index, index + 1000));
        } catch (storageError) {
          logServerError(request, storageError, "delete-household-storage");
        }
      }
      return json({ ok: true });
    }

    if (action === "leave_household") {
      if (body.confirmation !== "leave") return json({ error: "Confirm that you want to leave this household" }, 400);
      const activeMemberCount = await db.prepare(`SELECT COUNT(*) AS count FROM household_members WHERE household_id = ? AND status = 'active'`)
        .bind(householdId).first<{count:number}>();
      if (Number(activeMemberCount?.count) <= 1) return json({ error: "You are the only member. Delete the household instead." }, 400);
      const balance = await db.prepare(`SELECT
        COALESCE((SELECT SUM(amount_cents) FROM expenses WHERE household_id = ? AND paid_by_member_id = ? AND status = 'active' AND LOWER(category) <> 'rent'), 0)
        - COALESCE((SELECT SUM(s.share_cents) FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.household_id = ? AND s.member_id = ? AND e.status = 'active' AND LOWER(e.category) <> 'rent'), 0)
        + COALESCE((SELECT SUM(amount_cents) FROM settlements WHERE household_id = ? AND from_member_id = ?), 0)
        - COALESCE((SELECT SUM(amount_cents) FROM settlements WHERE household_id = ? AND to_member_id = ?), 0) AS amount_cents`)
        .bind(householdId, member.id, householdId, member.id, householdId, member.id, householdId, member.id).first<{amount_cents:number}>();
      if (Number(balance?.amount_cents) !== 0) return json({ error: "Settle your balance before leaving this household" }, 400);
      const recurringRows = await db.prepare(`SELECT id, paid_by_member_id, participant_ids FROM recurring_expenses WHERE household_id = ? AND active = 1`)
        .bind(householdId).all<Row>();
      const incompatibleIds = recurringRows.results.filter((row) => {
        let participants: number[] = [];
        try { participants = (JSON.parse(String(row.participant_ids)) as unknown[]).map(Number); } catch {}
        return Number(row.paid_by_member_id) === Number(member.id) || participants.includes(Number(member.id));
      }).map((row) => String(row.id));
      await db.batch([
        db.prepare(`UPDATE household_members SET status = 'left' WHERE id = ? AND household_id = ? AND user_id = ?`).bind(member.id, householdId, user.userId),
        ...incompatibleIds.map((id) => db.prepare(`UPDATE recurring_expenses SET active = 0 WHERE id = ? AND household_id = ?`).bind(id, householdId)),
      ]);
      return json({ ok: true, deactivatedRecurringCount: incompatibleIds.length });
    }

    if (action === "update_avatar_choice") {
      const avatarChoice = textValue(body.avatarChoice, 20);
      const allowedChoices = new Set(["indigo", "lime", "sunset", "ocean", "rose", "violet"]);
      if (!allowedChoices.has(avatarChoice)) return json({ error: "Choose a valid avatar" }, 400);
      await db.prepare(`UPDATE household_members SET avatar_choice = ?, avatar_key = NULL
        WHERE id = ? AND user_id = ?`).bind(avatarChoice, member.id, user.userId).run();
      if (member.avatar_key && env.BUCKET) {
        try { await env.BUCKET.delete(String(member.avatar_key)); }
        catch (storageError) { logServerError(request, storageError, "replace-avatar-choice-storage"); }
      }
      return json({ ok: true });
    }

    if (action === "update_member_categories") {
      const targetMemberId = Number(body.memberId);
      if (!Number.isInteger(targetMemberId)) return json({ error: "Choose a household member" }, 400);
      let applicableCategories: string[] | null;
      try { applicableCategories = normalizeApplicableCategories(body.applicableCategories); }
      catch (error) { return json({ error: error instanceof Error ? error.message : "Choose valid categories" }, 400); }
      const target = await db.prepare(`SELECT id FROM household_members WHERE id = ? AND household_id = ? AND status = 'active'`)
        .bind(targetMemberId, householdId).first<Row>();
      if (!target) return json({ error: "Household member not found" }, 404);

      const recurringRows = await db.prepare(`SELECT id, category, paid_by_member_id, participant_ids FROM recurring_expenses
        WHERE household_id = ? AND active = 1`).bind(householdId).all<Row>();
      const incompatibleIds = recurringRows.results.filter((row) => {
        if (applicableCategories === null || applicableCategories.includes(String(row.category))) return false;
        let participants: number[] = [];
        try { participants = (JSON.parse(String(row.participant_ids)) as unknown[]).map(Number); } catch {}
        return Number(row.paid_by_member_id) === targetMemberId || participants.includes(targetMemberId);
      }).map((row) => String(row.id));
      const statements = [
        db.prepare(`UPDATE household_members SET applicable_categories = ? WHERE id = ? AND household_id = ?`)
          .bind(applicableCategories === null ? null : JSON.stringify(applicableCategories), targetMemberId, householdId),
        ...incompatibleIds.map((id) => db.prepare(`UPDATE recurring_expenses SET active = 0 WHERE id = ? AND household_id = ?`).bind(id, householdId)),
      ];
      await db.batch(statements);
      return json({ ok: true, deactivatedRecurringCount: incompatibleIds.length });
    }

    if (action === "create_expense") {
      const description = textValue(body.description, 100);
      const category = textValue(body.category, 40) || "Other";
      const amountCents = money(body.amount);
      const paidByMemberId = Number(body.paidByMemberId);
      const participantIds = Array.isArray(body.participantIds) ? [...new Set(body.participantIds.map(Number).filter(Number.isInteger))] : [];
      const expenseDate = textValue(body.expenseDate, 10);
      if (!description || amountCents < 1 || !paidByMemberId || participantIds.length < 1 || !validDate(expenseDate)) return json({ error: "Complete the required expense fields" }, 400);
      if (expenseDate > requestToday(request)) return json({ error: "Expense date cannot be in the future" }, 400);
      if (category.toLowerCase() === "rent") return json({ error: "Rent is not tracked in MohaNagorik" }, 400);
      if (!EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) return json({ error: "Choose a valid category" }, 400);
      if (!isCategoryApplicable(member.applicable_categories, category)) return json({ error: `Your account cannot add ${category} expenses` }, 403);
      const allowed = await db.prepare(`SELECT id, applicable_categories FROM household_members WHERE household_id = ? AND status = 'active'`).bind(householdId).all<Row>();
      const allowedIds = new Set(allowed.results.map((r) => Number(r.id)));
      if (!allowedIds.has(paidByMemberId) || participantIds.some((id) => !allowedIds.has(id))) return json({ error: "Invalid household member" }, 400);
      const ineligible = allowed.results.filter((row) => (Number(row.id) === paidByMemberId || participantIds.includes(Number(row.id))) && !isCategoryApplicable(row.applicable_categories, category));
      if (ineligible.length) return json({ error: `Every payer and participant must be eligible for ${category}` }, 400);
      let shares: Array<{memberId:number; shareCents:number}> = [];
      if (body.splitType === "custom" && body.customShares && typeof body.customShares === "object") {
        shares = participantIds.map((id) => ({ memberId: id, shareCents: money((body.customShares as Record<string, unknown>)[String(id)]) }));
        if (shares.reduce((sum, s) => sum + s.shareCents, 0) !== amountCents) return json({ error: "Custom shares must equal the expense total" }, 400);
      } else {
        shares = splitEqually(amountCents, participantIds);
      }
      const id = crypto.randomUUID();
      const statements = [
        db.prepare(`INSERT INTO expenses (id, household_id, description, category, amount_cents, paid_by_member_id, expense_date, split_type, notes, created_by_user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, householdId, description, category, amountCents, paidByMemberId, expenseDate, body.splitType === "custom" ? "custom" : "equal", textValue(body.notes, 500), user.userId),
        ...shares.map((share) => db.prepare(`INSERT INTO expense_splits (expense_id, member_id, share_cents) VALUES (?, ?, ?)`).bind(id, share.memberId, share.shareCents)),
      ];
      await db.batch(statements);
      return json({ ok: true, expenseId: id });
    }

    if (action === "create_settlement") {
      const fromId = Number(body.fromMemberId), toId = Number(body.toMemberId), amountCents = money(body.amount);
      const settlementDate = textValue(body.settlementDate, 10);
      if (!fromId || !toId || fromId === toId || amountCents < 1 || !validDate(settlementDate)) return json({ error: "Enter a valid settlement" }, 400);
      if (settlementDate > requestToday(request)) return json({ error: "Payment date cannot be in the future" }, 400);
      const validMembers = await db.prepare(`SELECT COUNT(*) AS count FROM household_members
        WHERE household_id = ? AND status = 'active' AND id IN (?, ?)`).bind(householdId, fromId, toId).first<{count:number}>();
      if (Number(validMembers?.count) !== 2) return json({ error: "Choose members from this household" }, 400);
      const balances = (await householdPayload(householdId, user.userId, settlementDate.slice(0, 7))).balances;
      const payerBalance = balances.find((row) => row.memberId === fromId)?.amountCents ?? 0;
      const recipientBalance = balances.find((row) => row.memberId === toId)?.amountCents ?? 0;
      const maximumPayment = Math.min(-payerBalance, recipientBalance);
      if (payerBalance >= 0 || recipientBalance <= 0) return json({ error: "Choose a member who owes and a member who is owed" }, 400);
      if (amountCents > maximumPayment) return json({ error: `Payment cannot exceed ${(maximumPayment / 100).toFixed(2)}` }, 400);
      await db.prepare(`INSERT INTO settlements (id, household_id, from_member_id, to_member_id, amount_cents, settlement_date, notes, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), householdId, fromId, toId, amountCents, settlementDate, textValue(body.notes, 300), user.userId).run();
      return json({ ok: true });
    }

    if (action === "create_recurring") {
      const participantIds = Array.isArray(body.participantIds) ? [...new Set(body.participantIds.map(Number).filter(Number.isInteger))] : [];
      const category = textValue(body.category, 40) || "Other";
      const amountCents = money(body.amount);
      const nextDueDate = textValue(body.nextDueDate, 10);
      const cadence = textValue(body.cadence, 20);
      if (!textValue(body.description) || amountCents < 1 || participantIds.length < 1 || !validDate(nextDueDate)) return json({ error: "Complete the recurring bill details" }, 400);
      if (cadence !== "monthly" && cadence !== "quarterly") return json({ error: "Choose a valid recurring frequency" }, 400);
      if (category.toLowerCase() === "rent") return json({ error: "Rent is not tracked in MohaNagorik" }, 400);
      if (!EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) return json({ error: "Choose a valid category" }, 400);
      if (!isCategoryApplicable(member.applicable_categories, category)) return json({ error: `Your account cannot add ${category} recurring bills` }, 403);
      const recurringMembers = await db.prepare(`SELECT id, applicable_categories FROM household_members WHERE household_id = ? AND status = 'active'`).bind(householdId).all<Row>();
      const recurringAllowed = new Set(recurringMembers.results.map((r) => Number(r.id)));
      if (!recurringAllowed.has(Number(body.paidByMemberId)) || participantIds.some((id) => !recurringAllowed.has(id))) return json({ error: "Invalid household member" }, 400);
      const recurringIneligible = recurringMembers.results.filter((row) => (Number(row.id) === Number(body.paidByMemberId) || participantIds.includes(Number(row.id))) && !isCategoryApplicable(row.applicable_categories, category));
      if (recurringIneligible.length) return json({ error: `Every payer and participant must be eligible for ${category}` }, 400);
      await db.prepare(`INSERT INTO recurring_expenses (id, household_id, description, category, amount_cents, paid_by_member_id, cadence, next_due_date, participant_ids, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), householdId, textValue(body.description), category, amountCents, Number(body.paidByMemberId), cadence, nextDueDate, JSON.stringify(participantIds), user.userId).run();
      return json({ ok: true });
    }

    if (action === "post_recurring") {
      const recurringId = textValue(body.recurringId, 80);
      const recurring = await db.prepare(`SELECT * FROM recurring_expenses WHERE id = ? AND household_id = ? AND active = 1 AND LOWER(category) <> 'rent'`).bind(recurringId, householdId).first<Row>();
      if (!recurring) return json({ error: "Recurring bill not found" }, 404);
      if (!isCategoryApplicable(member.applicable_categories, String(recurring.category))) return json({ error: `Your account cannot post ${recurring.category} bills` }, 403);
      const participantIds = [...new Set((JSON.parse(String(recurring.participant_ids)) as number[]).map(Number).filter(Number.isInteger))];
      if (!participantIds.length) return json({ error: "This recurring bill has no participants" }, 400);
      const activeParticipants = await db.prepare(`SELECT id, applicable_categories FROM household_members WHERE household_id = ? AND status = 'active' AND id IN (${participantIds.map(() => "?").join(",")})`).bind(householdId, ...participantIds).all<Row>();
      if (activeParticipants.results.length !== participantIds.length || activeParticipants.results.some((row) => !isCategoryApplicable(row.applicable_categories, String(recurring.category)))) return json({ error: "Update the recurring bill members before posting" }, 400);
      const activePayer = await db.prepare(`SELECT id, applicable_categories FROM household_members WHERE household_id = ? AND status = 'active' AND id = ?`).bind(householdId, recurring.paid_by_member_id).first<Row>();
      if (!activePayer) return json({ error: "Update who pays this recurring bill before posting" }, 400);
      if (!isCategoryApplicable(activePayer.applicable_categories, String(recurring.category))) return json({ error: "The payer is not eligible for this bill category" }, 400);
      const amountCents = Number(recurring.amount_cents);
      const shares = splitEqually(amountCents, participantIds);
      const postedAt = new Date().toISOString();
      const cooldownCutoff = new Date(Date.now() - 10_000).toISOString();
      const lock = await db.prepare(`UPDATE recurring_expenses SET last_posted_at = ?
        WHERE id = ? AND household_id = ? AND (last_posted_at IS NULL OR last_posted_at <= ?)`)
        .bind(postedAt, recurringId, householdId, cooldownCutoff).run();
      if (Number(lock.meta.changes) !== 1) return json({ error: "Please wait 10 seconds before posting this bill again" }, 429);
      const expenseId = crypto.randomUUID();
      const date = requestToday(request);
      const nextDueDate = addMonthsClamped(String(recurring.next_due_date), recurring.cadence === "quarterly" ? 3 : 1);
      try {
        await db.batch([
          db.prepare(`INSERT INTO expenses (id, household_id, description, category, amount_cents, paid_by_member_id, expense_date, split_type, notes, created_by_user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'equal', 'Added from recurring bills', ?)`).bind(expenseId, householdId, recurring.description, recurring.category, amountCents, recurring.paid_by_member_id, date, user.userId),
          ...shares.map((share) => db.prepare(`INSERT INTO expense_splits (expense_id, member_id, share_cents) VALUES (?, ?, ?)`).bind(expenseId, share.memberId, share.shareCents)),
          db.prepare(`UPDATE recurring_expenses SET next_due_date = ? WHERE id = ?`).bind(nextDueDate, recurringId),
        ]);
      } catch (postError) {
        try {
          await db.prepare(`UPDATE recurring_expenses SET last_posted_at = ? WHERE id = ? AND last_posted_at = ?`)
            .bind(recurring.last_posted_at, recurringId, postedAt).run();
        } catch (unlockError) {
          logServerError(request, unlockError, "unlock-recurring-after-failure");
        }
        throw postError;
      }
      return json({ ok: true });
    }

    if (action === "void_expense") {
      const expenseId = textValue(body.expenseId, 80);
      const expense = await db.prepare(`SELECT receipt_key FROM expenses WHERE id = ? AND household_id = ? AND status = 'active'`).bind(expenseId, householdId).first<{receipt_key:string|null}>();
      if (!expense) return json({ error: "Expense not found" }, 404);
      await db.prepare(`UPDATE expenses SET status = 'void', receipt_key = NULL WHERE id = ? AND household_id = ? AND status = 'active'`).bind(expenseId, householdId).run();
      if (expense.receipt_key && env.BUCKET) {
        try { await env.BUCKET.delete(expense.receipt_key); }
        catch (storageError) { logServerError(request, storageError, "void-expense-storage"); }
      }
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON request" }, 400);
    logServerError(request, error, "mutate-household");
    return json({ error: "Request failed" }, 500);
  }
}
