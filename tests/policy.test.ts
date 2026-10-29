import { describe, expect, it } from "vitest";
import { EMPLOYEES } from "../src/db/seed-data";
import { expectedDecision, oracleReceipt } from "../src/eval/receipts/decisions";
import { REF_DATE, SPECS } from "../src/eval/receipts/specs";
import { usdPerUnit } from "../src/lib/fx";
import { evaluate, type PolicyFacts, withReviewerFlags } from "../src/policy/engine";
import { receipt } from "./fixtures";

// Seed people, keyed by email; ids are the emails so approvers are easy to read in assertions.
const people = Object.fromEntries(EMPLOYEES.map((e) => [e.email, e]));
const submitter = (email: string): PolicyFacts["submitter"] => ({
  id: email,
  role: people[email].role,
  managerId: people[email].manager,
});

function facts(overrides: Partial<PolicyFacts> = {}): PolicyFacts {
  return {
    receipt: receipt(),
    warnings: [],
    submitter: submitter("priya@northwind.test"),
    usdPerUnit: 1,
    duplicateOf: null,
    mealsSpentSameDayUsdCents: 0,
    today: "2026-10-20",
    ...overrides,
  };
}

describe("policy engine on the receipt set (perfect extraction)", () => {
  it.each(SPECS.map((s) => [s.id, s] as const))("%s", (id, spec) => {
    const want = expectedDecision(id);
    const d = evaluate({
      receipt: oracleReceipt(spec),
      warnings: id === "h18" ? ["subtotal + tax + tip = 32.66 but total is 42.66"] : [],
      submitter: submitter(spec.submittedBy),
      usdPerUnit: usdPerUnit(spec.currency),
      duplicateOf: spec.duplicateOf ?? null,
      mealsSpentSameDayUsdCents: 0,
      today: REF_DATE,
    });

    expect(d.outcome).toBe(want.outcome);
    const approvers = d.approvals.map((a) =>
      a.approver.kind === "employee" ? "manager" : a.approver.role,
    );
    expect(approvers).toEqual(want.approvers ?? []);
    // Ordinary meals may legitimately hit the daily cap; hard cases list every adjustment.
    if (id.startsWith("h")) expect(d.adjustments.map((a) => a.rule)).toEqual(want.adjusted ?? []);
  });
});

describe("policy engine rules", () => {
  it("approves a clean receipt in full", () => {
    const d = evaluate(facts());
    expect(d).toMatchObject({ outcome: "approve", claimedUsdCents: 2478, reimbursableUsdCents: 2478, approvals: [] });
  });

  it("caps a meal at what's left of the daily limit", () => {
    const d = evaluate(facts({ mealsSpentSameDayUsdCents: 6000 }));
    expect(d.reimbursableUsdCents).toBe(1500);
    expect(d.adjustments[0].text).toContain("$60.00 already claimed that day");
  });

  it("rejects a meal when the day's limit is already used up", () => {
    expect(evaluate(facts({ mealsSpentSameDayUsdCents: 7500 })).outcome).toBe("reject");
  });

  it("gives managers the higher meal limit", () => {
    const big = receipt({ subtotal: 100, tax: 0, tip: 0, total: 100, line_items: [] });
    expect(evaluate(facts({ receipt: big })).reimbursableUsdCents).toBe(7500);
    expect(evaluate(facts({ receipt: big, submitter: submitter("jordan@northwind.test") })).reimbursableUsdCents).toBe(10000);
  });

  it("removes alcohol together with its share of tax and tip", () => {
    const r = receipt({
      subtotal: 40,
      tax: 4,
      tip: 8,
      total: 52,
      line_items: [
        { description: "Burger", quantity: 1, amount: 30, is_alcohol: false },
        { description: "IPA", quantity: 1, amount: 10, is_alcohol: true },
      ],
      contains_alcohol: true,
    });
    // 10 + 25% of (4 + 8) = 13 removed
    expect(evaluate(facts({ receipt: r })).reimbursableUsdCents).toBe(3900);
  });

  it("converts foreign currency before applying limits", () => {
    const r = receipt({ currency: "EUR", subtotal: 80, tax: 0, tip: 0, total: 80, line_items: [] });
    const d = evaluate(facts({ receipt: r, usdPerUnit: 1.08 }));
    expect(d.claimedUsdCents).toBe(8640);
    expect(d.reimbursableUsdCents).toBe(7500);
  });

  it("asks for a clearer copy when the date is a guess", () => {
    const r = receipt({ confidence: { merchant: "high", date: "low", currency: "high", total: "high" } });
    expect(evaluate(facts({ receipt: r })).outcome).toBe("needs_info");
  });

  it("rejects receipts dated more than 90 days ago, and asks about future dates", () => {
    expect(evaluate(facts({ receipt: receipt({ date: "2026-07-21" }) })).outcome).toBe("reject");
    expect(evaluate(facts({ receipt: receipt({ date: "2026-07-22" }) })).outcome).toBe("approve");
    expect(evaluate(facts({ receipt: receipt({ date: "2026-10-21" }) })).outcome).toBe("needs_info");
  });

  it("sends a manager's own expenses to Finance when they have no manager", () => {
    const r = receipt({ category: "other" });
    const d = evaluate(facts({ receipt: r, submitter: submitter("jordan@northwind.test") }));
    expect(d.approvals.map((a) => a.approver)).toEqual([{ kind: "role", role: "finance" }]);
  });

  it("chains approvals: manager, then IT, then Finance", () => {
    const r = receipt({
      category: "equipment",
      subtotal: 1500,
      tax: 0,
      tip: 0,
      total: 1500,
      line_items: [],
      instructions_detected: false,
    });
    const d = evaluate(facts({ receipt: r, warnings: ["numbers are off"] }));
    expect(d.approvals.map((a) => a.approver)).toEqual([
      { kind: "employee", employeeId: "jordan@northwind.test" },
      { kind: "role", role: "it" },
      { kind: "role", role: "finance" },
    ]);
  });
});

describe("reviewer flags", () => {
  const priya = submitter("priya@northwind.test");

  it("turn an approval into a manager approval", () => {
    const d = withReviewerFlags(evaluate(facts()), [{ approver: "manager", reason: "Looks like a personal purchase." }], priya);
    expect(d.outcome).toBe("needs_approval");
    expect(d.approvals).toEqual([
      {
        approver: { kind: "employee", employeeId: "jordan@northwind.test" },
        rules: ["REVIEWER_FLAG"],
        reason: "Flagged by the AI reviewer. Looks like a personal purchase.",
      },
    ]);
    expect(d.reimbursableUsdCents).toBe(2478); // amounts untouched
  });

  it("join an existing step for the same approver", () => {
    const base = evaluate(facts({ receipt: receipt({ category: "other" }) }));
    const d = withReviewerFlags(base, [{ approver: "manager", reason: "Gift?" }], priya);
    expect(d.approvals).toHaveLength(1);
    expect(d.approvals[0].rules).toEqual(["OTHER", "REVIEWER_FLAG"]);
  });

  it("can't overturn a rejection", () => {
    const rejected = evaluate(facts({ duplicateOf: "e1" }));
    expect(withReviewerFlags(rejected, [{ approver: "finance", reason: "x" }], priya)).toBe(rejected);
  });
});
