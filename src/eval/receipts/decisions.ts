import type { Outcome } from "../../policy/engine";
import type { Receipt } from "../../lib/receipt";
import { SPECS, truth, type ReceiptSpec } from "./specs";

/**
 * Expected policy outcome per receipt, with the reference date as "today", no other expenses that
 * day, and h07 known to duplicate n03. `approvers` lists who has to sign off, in order.
 * Every ordinary receipt (n01–n20) should be approved.
 */
export type ExpectedDecision = { outcome: Outcome; approvers?: ("manager" | "it" | "finance")[]; adjusted?: string[] };

const HARD: Record<string, ExpectedDecision> = {
  h01: { outcome: "approve", adjusted: ["TIP_CAP", "MEAL_LIMIT"] }, // $14 tip on $62 is over 20% too
  h02: { outcome: "approve" },
  h03: { outcome: "approve" },
  h04: { outcome: "needs_info" },
  h05: { outcome: "approve", adjusted: ["ALCOHOL"] },
  h06: { outcome: "needs_approval", approvers: ["finance"], adjusted: ["CAP"] },
  h07: { outcome: "reject" },
  h08: { outcome: "reject" },
  h09: { outcome: "needs_info" },
  h10: { outcome: "needs_approval", approvers: ["it"] },
  h11: { outcome: "needs_approval", approvers: ["finance"] }, // flight + over $1,000; Alex has no manager
  h12: { outcome: "approve" },
  h13: { outcome: "approve" },
  h14: { outcome: "approve" },
  h15: { outcome: "needs_approval", approvers: ["manager"] },
  h16: { outcome: "approve", adjusted: ["TIP_CAP"] },
  h17: { outcome: "approve" },
  h18: { outcome: "needs_approval", approvers: ["manager"] },
  h19: { outcome: "approve" },
  h20: { outcome: "needs_approval", approvers: ["manager"] },
};

export function expectedDecision(id: string): ExpectedDecision {
  return HARD[id] ?? { outcome: "approve" };
}

/**
 * The receipt a perfect extractor would return for a spec. Lets the decision evals separate
 * "the model misread the receipt" from "the agent made the wrong call".
 */
export function oracleReceipt(s: ReceiptSpec): Receipt {
  const t = truth(s);
  const high = "high" as const;
  return {
    is_receipt: t.is_receipt,
    merchant: t.merchant,
    date: t.date,
    currency: t.currency,
    subtotal: t.subtotal,
    tax: t.tax || null,
    tip: t.tip,
    total: t.total_legible ? t.total : null,
    line_items: s.notReceipt
      ? []
      : s.items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          amount: Math.round(i.quantity * i.unitPrice * 100) / 100,
          is_alcohol: !!i.alcohol,
        })),
    category: t.category,
    contains_alcohol: t.contains_alcohol,
    instructions_detected: t.instructions_detected,
    confidence: { merchant: high, date: high, currency: high, total: t.total_legible ? high : "low" },
    notes: "",
  };
}

export const specById = (id: string) => SPECS.find((s) => s.id === id)!;
