export type BalanceInput = {
  memberId: number;
  name: string;
  isCurrentUser?: boolean;
};

export type MoneyByMember = { memberId: number; amountCents: number };
export type SettlementInput = { fromMemberId: number; toMemberId: number; amountCents: number };

export function addMonthsClamped(dateValue: string, months: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!match || !Number.isInteger(months) || months < 1) throw new Error("Invalid recurring date");
  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue), month = Number(monthValue) - 1, day = Number(dayValue);
  const source = new Date(Date.UTC(year, month, day));
  if (source.getUTCFullYear() !== year || source.getUTCMonth() !== month || source.getUTCDate() !== day) throw new Error("Invalid recurring date");
  const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
  const lastTargetDay = new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth(), Math.min(day, lastTargetDay))).toISOString().slice(0, 10);
}

export function splitEqually(amountCents: number, participantIds: number[]) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) throw new Error("Amount must be a positive number of cents");
  const ids = [...new Set(participantIds)].filter(Number.isSafeInteger).sort((a, b) => a - b);
  if (!ids.length) throw new Error("At least one participant is required");

  const base = Math.floor(amountCents / ids.length);
  let remainder = amountCents - base * ids.length;
  return ids.map((memberId) => ({ memberId, shareCents: base + (remainder-- > 0 ? 1 : 0) }));
}

export function calculateBalances(
  members: BalanceInput[],
  paid: MoneyByMember[],
  owed: MoneyByMember[],
  settlements: SettlementInput[],
) {
  const balances = new Map(members.map((member) => [member.memberId, 0]));
  for (const row of paid) balances.set(row.memberId, (balances.get(row.memberId) ?? 0) + row.amountCents);
  for (const row of owed) balances.set(row.memberId, (balances.get(row.memberId) ?? 0) - row.amountCents);
  for (const row of settlements) {
    balances.set(row.fromMemberId, (balances.get(row.fromMemberId) ?? 0) + row.amountCents);
    balances.set(row.toMemberId, (balances.get(row.toMemberId) ?? 0) - row.amountCents);
  }
  return members.map((member) => ({ ...member, amountCents: balances.get(member.memberId) ?? 0 }));
}

export function simplifySettlements(balances: Array<BalanceInput & { amountCents: number }>) {
  const debtors = balances.filter((row) => row.amountCents < 0).map((row) => ({ ...row })).sort((a, b) => a.amountCents - b.amountCents);
  const creditors = balances.filter((row) => row.amountCents > 0).map((row) => ({ ...row })).sort((a, b) => b.amountCents - a.amountCents);
  const result: Array<{ fromMemberId: number; fromName: string; toMemberId: number; toName: string; amountCents: number }> = [];

  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(-debtor.amountCents, creditor.amountCents);
    result.push({
      fromMemberId: debtor.memberId,
      fromName: debtor.name,
      toMemberId: creditor.memberId,
      toName: creditor.name,
      amountCents,
    });
    debtor.amountCents += amountCents;
    creditor.amountCents -= amountCents;
    if (debtor.amountCents === 0) debtorIndex++;
    if (creditor.amountCents === 0) creditorIndex++;
  }
  return result;
}
