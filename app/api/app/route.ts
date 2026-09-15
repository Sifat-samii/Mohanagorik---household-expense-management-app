import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getGoogleUser } from "../../google-auth";

type Row = Record<string, string | number | null>;

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const money = (value: unknown) => Math.max(0, Math.round(Number(value) * 100));
const textValue = (value: unknown, max = 120) => String(value ?? "").trim().slice(0, max);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

async function currentUser() {
  const user = await getGoogleUser();
  if (!user) return null;
  const db = env.DB;
  if (!db) throw new Error("Database unavailable");
  await db.prepare(`INSERT INTO profiles (user_id, email, display_name) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name`)
    .bind(user.userId, user.email, user.displayName).run();
  return user;
}

async function membership(householdId: string, userId: string) {
  return env.DB!.prepare(`SELECT id, household_id, user_id, display_name, role FROM household_members
    WHERE household_id = ? AND user_id = ? AND status = 'active'`)
    .bind(householdId, userId).first<Row>();
}

async function householdPayload(householdId: string, userId: string, selectedMonth: string) {
  const db = env.DB!;
  const member = await membership(householdId, userId);
  if (!member) throw new Error("Household access denied");

  const [home, members, expenses, monthlyExpenses, splits, settlements, recurring, paidTotals, owedTotals, settlementTotals, monthlyPaidTotals, monthlySettlementPayments] = await Promise.all([
    db.prepare(`SELECT id, name, currency, invite_code, owner_id FROM households WHERE id = ?`).bind(householdId).first<Row>(),
    db.prepare(`SELECT id, user_id, display_name, role, joined_at FROM household_members WHERE household_id = ? AND status = 'active' ORDER BY joined_at`).bind(householdId).all<Row>(),
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
      JOIN expenses e ON e.id = s.expense_id WHERE e.household_id = ? AND e.status = 'active' AND LOWER(e.category) <> 'rent'`).bind(householdId).all<Row>(),
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
  ]);

  const balances = new Map<number, number>();
  for (const m of members.results) balances.set(Number(m.id), 0);
  for (const paid of paidTotals.results) {
    const payer = Number(paid.member_id);
    balances.set(payer, (balances.get(payer) ?? 0) + Number(paid.amount_cents));
  }
  for (const owed of owedTotals.results) {
    const id = Number(owed.member_id);
    balances.set(id, (balances.get(id) ?? 0) - Number(owed.amount_cents));
  }
  for (const s of settlementTotals.results) {
    const from = Number(s.from_member_id);
    const to = Number(s.to_member_id);
    const amount = Number(s.amount_cents);
    balances.set(from, (balances.get(from) ?? 0) + amount);
    balances.set(to, (balances.get(to) ?? 0) - amount);
  }

  const balanceRows = members.results.map((m) => ({
    memberId: Number(m.id),
    name: String(m.display_name),
    amountCents: balances.get(Number(m.id)) ?? 0,
    isCurrentUser: m.user_id === userId,
  }));
  const debtors = balanceRows.filter((b) => b.amountCents < -1).map((b) => ({ ...b })).sort((a, b) => a.amountCents - b.amountCents);
  const creditors = balanceRows.filter((b) => b.amountCents > 1).map((b) => ({ ...b })).sort((a, b) => b.amountCents - a.amountCents);
  const suggestedSettlements: Array<{fromMemberId:number; fromName:string; toMemberId:number; toName:string; amountCents:number}> = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const amount = Math.min(-debtors[di].amountCents, creditors[ci].amountCents);
    suggestedSettlements.push({ fromMemberId: debtors[di].memberId, fromName: debtors[di].name, toMemberId: creditors[ci].memberId, toName: creditors[ci].name, amountCents: amount });
    debtors[di].amountCents += amount;
    creditors[ci].amountCents -= amount;
    if (Math.abs(debtors[di].amountCents) < 2) di++;
    if (Math.abs(creditors[ci].amountCents) < 2) ci++;
  }

  const categoryMap = new Map<string, number>();
  let monthTotalCents = 0;
  for (const e of monthlyExpenses.results) {
    monthTotalCents += Number(e.amount_cents);
    const category = String(e.category);
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + Number(e.amount_cents));
  }
  const categories = [...categoryMap].map(([name, amountCents]) => ({ name, amountCents })).sort((a, b) => b.amountCents - a.amountCents);
  const expensePaidByMember = new Map(monthlyPaidTotals.results.map((row) => [Number(row.member_id), Number(row.amount_cents)]));
  const settlementPaidByMember = new Map(monthlySettlementPayments.results.map((row) => [Number(row.member_id), Number(row.amount_cents)]));
  const memberSpending = members.results.map((row) => ({
    memberId: Number(row.id),
    name: String(row.display_name),
    expenseAmountCents: expensePaidByMember.get(Number(row.id)) ?? 0,
    settlementAmountCents: settlementPaidByMember.get(Number(row.id)) ?? 0,
    amountCents: (expensePaidByMember.get(Number(row.id)) ?? 0) + (settlementPaidByMember.get(Number(row.id)) ?? 0),
  })).sort((a, b) => b.amountCents - a.amountCents);
  const enrichedExpenses = expenses.results.map((e) => ({
    ...e,
    splits: splits.results.filter((s) => s.expense_id === e.id),
  }));

  return {
    household: home,
    currentMemberId: Number(member.id),
    members: members.results,
    expenses: enrichedExpenses,
    settlements: settlements.results,
    recurring: recurring.results,
    balances: balanceRows,
    suggestedSettlements,
    selectedMonth,
    monthlyExpenses: monthlyExpenses.results,
    memberSpending,
    monthTotalCents,
    categories,
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Sign in required" }, 401);
    const homes = await env.DB!.prepare(`SELECT h.id, h.name, h.currency, h.invite_code, hm.role
      FROM households h JOIN household_members hm ON hm.household_id = h.id
      WHERE hm.user_id = ? AND hm.status = 'active' ORDER BY hm.joined_at`).bind(user.userId).all<Row>();
    const householdId = request.nextUrl.searchParams.get("householdId") || String(homes.results[0]?.id ?? "");
    const currentMonth = new Date().toISOString().slice(0, 7);
    const requestedMonth = request.nextUrl.searchParams.get("month") ?? currentMonth;
    const selectedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) && requestedMonth <= currentMonth ? requestedMonth : currentMonth;
    if (!householdId) return json({ households: homes.results, active: null });
    return json({ households: homes.results, active: await householdPayload(householdId, user.userId, selectedMonth) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to load MohaNagorik" }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "Sign in required" }, 401);
    const body = await request.json() as Record<string, unknown>;
    const action = textValue(body.action, 40);
    const db = env.DB!;

    if (action === "create_household") {
      const name = textValue(body.name, 60);
      if (name.length < 2) return json({ error: "Enter a household name" }, 400);
      const id = crypto.randomUUID();
      const inviteCode = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
      await db.batch([
        db.prepare(`INSERT INTO households (id, name, currency, invite_code, owner_id) VALUES (?, ?, ?, ?, ?)`).bind(id, name, textValue(body.currency, 3) || "BDT", inviteCode, user.userId),
        db.prepare(`INSERT INTO household_members (household_id, user_id, display_name, role) VALUES (?, ?, ?, 'owner')`).bind(id, user.userId, user.displayName),
      ]);
      return json({ ok: true, householdId: id });
    }

    if (action === "join_household") {
      const code = textValue(body.inviteCode, 20).toUpperCase();
      const home = await db.prepare(`SELECT id FROM households WHERE invite_code = ?`).bind(code).first<Row>();
      if (!home) return json({ error: "That invite code was not found" }, 404);
      await db.prepare(`INSERT INTO household_members (household_id, user_id, display_name, role)
        VALUES (?, ?, ?, 'member') ON CONFLICT(household_id, user_id) DO UPDATE SET status = 'active'`)
        .bind(home.id, user.userId, user.displayName).run();
      return json({ ok: true, householdId: home.id });
    }

    const householdId = textValue(body.householdId, 80);
    const member = await membership(householdId, user.userId);
    if (!member) return json({ error: "Household access denied" }, 403);

    if (action === "create_expense") {
      const description = textValue(body.description, 100);
      const category = textValue(body.category, 40) || "Other";
      const amountCents = money(body.amount);
      const paidByMemberId = Number(body.paidByMemberId);
      const participantIds = Array.isArray(body.participantIds) ? [...new Set(body.participantIds.map(Number).filter(Number.isInteger))] : [];
      const expenseDate = textValue(body.expenseDate, 10);
      if (!description || amountCents < 1 || !paidByMemberId || participantIds.length < 1 || !validDate(expenseDate)) return json({ error: "Complete the required expense fields" }, 400);
      if (category.toLowerCase() === "rent") return json({ error: "Rent is not tracked in MohaNagorik" }, 400);
      const allowed = await db.prepare(`SELECT id FROM household_members WHERE household_id = ? AND status = 'active'`).bind(householdId).all<Row>();
      const allowedIds = new Set(allowed.results.map((r) => Number(r.id)));
      if (!allowedIds.has(paidByMemberId) || participantIds.some((id) => !allowedIds.has(id))) return json({ error: "Invalid household member" }, 400);
      let shares: Array<{memberId:number; shareCents:number}> = [];
      if (body.splitType === "custom" && body.customShares && typeof body.customShares === "object") {
        shares = participantIds.map((id) => ({ memberId: id, shareCents: money((body.customShares as Record<string, unknown>)[String(id)]) }));
        if (shares.reduce((sum, s) => sum + s.shareCents, 0) !== amountCents) return json({ error: "Custom shares must equal the expense total" }, 400);
      } else {
        const base = Math.floor(amountCents / participantIds.length);
        let remainder = amountCents - base * participantIds.length;
        shares = participantIds.map((id) => ({ memberId: id, shareCents: base + (remainder-- > 0 ? 1 : 0) }));
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
      if (!textValue(body.description) || amountCents < 1 || participantIds.length < 1 || !validDate(nextDueDate)) return json({ error: "Complete the recurring bill details" }, 400);
      if (category.toLowerCase() === "rent") return json({ error: "Rent is not tracked in MohaNagorik" }, 400);
      const recurringMembers = await db.prepare(`SELECT id FROM household_members WHERE household_id = ? AND status = 'active'`).bind(householdId).all<Row>();
      const recurringAllowed = new Set(recurringMembers.results.map((r) => Number(r.id)));
      if (!recurringAllowed.has(Number(body.paidByMemberId)) || participantIds.some((id) => !recurringAllowed.has(id))) return json({ error: "Invalid household member" }, 400);
      await db.prepare(`INSERT INTO recurring_expenses (id, household_id, description, category, amount_cents, paid_by_member_id, cadence, next_due_date, participant_ids, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), householdId, textValue(body.description), category, amountCents, Number(body.paidByMemberId), textValue(body.cadence, 20) || "monthly", nextDueDate, JSON.stringify(participantIds), user.userId).run();
      return json({ ok: true });
    }

    if (action === "post_recurring") {
      const recurringId = textValue(body.recurringId, 80);
      const recurring = await db.prepare(`SELECT * FROM recurring_expenses WHERE id = ? AND household_id = ? AND active = 1 AND LOWER(category) <> 'rent'`).bind(recurringId, householdId).first<Row>();
      if (!recurring) return json({ error: "Recurring bill not found" }, 404);
      const participantIds = [...new Set((JSON.parse(String(recurring.participant_ids)) as number[]).map(Number).filter(Number.isInteger))];
      if (!participantIds.length) return json({ error: "This recurring bill has no participants" }, 400);
      const activeParticipants = await db.prepare(`SELECT COUNT(*) AS count FROM household_members WHERE household_id = ? AND status = 'active' AND id IN (${participantIds.map(() => "?").join(",")})`).bind(householdId, ...participantIds).first<{count:number}>();
      if (Number(activeParticipants?.count) !== participantIds.length) return json({ error: "Update the recurring bill members before posting" }, 400);
      const amountCents = Number(recurring.amount_cents);
      const base = Math.floor(amountCents / participantIds.length);
      let remainder = amountCents - base * participantIds.length;
      const expenseId = crypto.randomUUID();
      const date = new Date().toISOString().slice(0, 10);
      const due = new Date(String(recurring.next_due_date) + "T00:00:00Z");
      due.setUTCMonth(due.getUTCMonth() + (recurring.cadence === "quarterly" ? 3 : 1));
      await db.batch([
        db.prepare(`INSERT INTO expenses (id, household_id, description, category, amount_cents, paid_by_member_id, expense_date, split_type, notes, created_by_user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'equal', 'Added from recurring bills', ?)`).bind(expenseId, householdId, recurring.description, recurring.category, amountCents, recurring.paid_by_member_id, date, user.userId),
        ...participantIds.map((id) => db.prepare(`INSERT INTO expense_splits (expense_id, member_id, share_cents) VALUES (?, ?, ?)`).bind(expenseId, id, base + (remainder-- > 0 ? 1 : 0))),
        db.prepare(`UPDATE recurring_expenses SET next_due_date = ? WHERE id = ?`).bind(due.toISOString().slice(0, 10), recurringId),
      ]);
      return json({ ok: true });
    }

    if (action === "void_expense") {
      const expenseId = textValue(body.expenseId, 80);
      await db.prepare(`UPDATE expenses SET status = 'void' WHERE id = ? AND household_id = ?`).bind(expenseId, householdId).run();
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Request failed" }, 500);
  }
}
