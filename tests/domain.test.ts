import assert from "node:assert/strict";
import test from "node:test";
import { calculateBalances, simplifySettlements, splitEqually } from "../lib/domain.ts";

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
