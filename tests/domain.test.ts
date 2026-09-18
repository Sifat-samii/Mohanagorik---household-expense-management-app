import assert from "node:assert/strict";
import test from "node:test";
import { addMonthsClamped, calculateBalances, simplifySettlements, splitEqually } from "../lib/domain.ts";
import { isCategoryApplicable, normalizeApplicableCategories, parseApplicableCategories } from "../lib/categories.ts";

test("equal splits preserve every cent", () => {
  const shares = splitEqually(1000, [4, 2, 1]);
  assert.deepEqual(shares, [
    { memberId: 1, shareCents: 334 },
    { memberId: 2, shareCents: 333 },
    { memberId: 4, shareCents: 333 },
  ]);
  assert.equal(shares.reduce((total, row) => total + row.shareCents, 0), 1000);
});

test("settlements move both sides toward zero", () => {
  const balances = calculateBalances(
    [{ memberId: 1, name: "A" }, { memberId: 2, name: "B" }, { memberId: 3, name: "C" }, { memberId: 4, name: "D" }],
    [{ memberId: 1, amountCents: 4000 }],
    [1, 2, 3, 4].map((memberId) => ({ memberId, amountCents: 1000 })),
    [{ fromMemberId: 2, toMemberId: 1, amountCents: 1000 }],
  );
  assert.deepEqual(balances.map((row) => row.amountCents), [2000, 0, -1000, -1000]);
  assert.equal(balances.reduce((total, row) => total + row.amountCents, 0), 0);
});

test("simplified settlements clear all balances", () => {
  const balances = [
    { memberId: 1, name: "A", amountCents: 3000 },
    { memberId: 2, name: "B", amountCents: -1000 },
    { memberId: 3, name: "C", amountCents: -1000 },
    { memberId: 4, name: "D", amountCents: -1000 },
  ];
  const settlements = simplifySettlements(balances);
  assert.equal(settlements.length, 3);
  const cleared = calculateBalances(
    balances.map(({ memberId, name }) => ({ memberId, name })),
    balances.filter((row) => row.amountCents > 0).map((row) => ({ memberId: row.memberId, amountCents: row.amountCents })),
    balances.filter((row) => row.amountCents < 0).map((row) => ({ memberId: row.memberId, amountCents: -row.amountCents })),
    settlements,
  );
  assert.ok(cleared.every((row) => row.amountCents === 0));
});

test("one-cent balances are not hidden from settlement suggestions", () => {
  assert.deepEqual(simplifySettlements([
    { memberId: 1, name: "A", amountCents: 1 },
    { memberId: 2, name: "B", amountCents: -1 },
  ]), [{ fromMemberId: 2, fromName: "B", toMemberId: 1, toName: "A", amountCents: 1 }]);
});

test("custom shares settle each member to their exact share", () => {
  const members = [{ memberId: 1, name: "A" }, { memberId: 2, name: "B" }, { memberId: 3, name: "C" }];
  const paid = [{ memberId: 1, amountCents: 1000 }];
  const owed = [{ memberId: 1, amountCents: 200 }, { memberId: 2, amountCents: 300 }, { memberId: 3, amountCents: 500 }];
  const transfers = simplifySettlements(calculateBalances(members, paid, owed, []));
  assert.deepEqual(calculateBalances(members, paid, owed, transfers).map((row) => row.amountCents), [0, 0, 0]);
});

test("recurring dates stay on the last valid day of the target month", () => {
  assert.equal(addMonthsClamped("2025-01-31", 1), "2025-02-28");
  assert.equal(addMonthsClamped("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonthsClamped("2025-11-30", 3), "2026-02-28");
});

test("members with no category restriction remain eligible everywhere", () => {
  assert.equal(isCategoryApplicable(null, "Groceries"), true);
  assert.equal(isCategoryApplicable(null, "Electricity"), true);
});

test("category-restricted members are eligible only for selected categories", () => {
  const stored = JSON.stringify(["Groceries", "Transport"]);
  assert.deepEqual(parseApplicableCategories(stored), ["Groceries", "Transport"]);
  assert.equal(isCategoryApplicable(stored, "Groceries"), true);
  assert.equal(isCategoryApplicable(stored, "Gas"), false);
});

test("category selection is normalized and rejects empty restrictions", () => {
  assert.deepEqual(normalizeApplicableCategories(["Groceries", "Groceries"]), ["Groceries"]);
  assert.equal(normalizeApplicableCategories(["Groceries", "Electricity", "Gas", "Internet", "Cleaning", "Household", "Maintenance", "Transport", "Other"]), null);
  assert.throws(() => normalizeApplicableCategories([]), /at least one/);
  assert.equal(isCategoryApplicable("not-json", "Groceries"), false);
});
