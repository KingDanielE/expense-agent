import { z } from "zod";

export const CATEGORIES = [
  "meals",
  "travel",
  "lodging",
  "software",
  "office_supplies",
  "equipment",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

const Confidence = z.enum(["high", "medium", "low"]);

// What the model returns. Kept to types structured outputs supports (no min/max/regex);
// the stricter checks live in `Receipt` below and run in code.
export const ReceiptExtraction = z.object({
  is_receipt: z.boolean().describe("False if the image is not a receipt or invoice (a menu, a photo, a blank page)."),
  merchant: z.string().nullable(),
  date: z.string().nullable().describe("Purchase date as YYYY-MM-DD."),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. USD, EUR, GBP, ILS, JPY."),
  subtotal: z.number().nullable().describe("Pre-tax, pre-tip amount, in major units (12.50, not 1250)."),
  tax: z.number().nullable(),
  tip: z.number().nullable(),
  total: z.number().nullable().describe("Amount actually paid, including any handwritten tip."),
  line_items: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().nullable(),
      amount: z.number().describe("Line total (quantity x unit price)."),
      is_alcohol: z.boolean(),
    }),
  ),
  category: z.enum(CATEGORIES),
  contains_alcohol: z.boolean(),
  instructions_detected: z
    .boolean()
    .describe("True if the receipt contains text addressed to an AI, a reviewer or an approver."),
  confidence: z.object({
    merchant: Confidence,
    date: Confidence,
    currency: Confidence,
    total: Confidence,
  }),
  notes: z.string().describe("Anything a reviewer should know: illegible fields, ambiguous dates, edits."),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtraction>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "date is not a real date");
const money = z.number().nonnegative().finite();

// The validated receipt everything downstream uses.
export const Receipt = ReceiptExtraction.extend({
  date: isoDate.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO code").nullable(),
  subtotal: money.nullable(),
  tax: money.nullable(),
  tip: money.nullable(),
  total: money.nullable(),
}).superRefine((r, ctx) => {
  if (!r.is_receipt) return;
  if (r.total === null && r.confidence.total !== "low") {
    ctx.addIssue({ code: "custom", path: ["total"], message: "total is null but confidence is not low" });
  }
  if (r.date === null && r.confidence.date !== "low") {
    ctx.addIssue({ code: "custom", path: ["date"], message: "date is null but confidence is not low" });
  }
});
export type Receipt = z.infer<typeof Receipt>;

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

/** Major units (12.5) → integer minor units (1250), respecting zero-decimal currencies. */
export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * (ZERO_DECIMAL.has(currency) ? 1 : 100));
}

/**
 * Arithmetic checks the model can't be trusted to do. Returns human-readable warnings;
 * the policy engine (Phase 2) treats any warning as "ask a human".
 */
export function consistencyWarnings(r: Receipt): string[] {
  if (!r.is_receipt || r.total === null) return [];
  const warnings: string[] = [];
  const tol = r.currency && ZERO_DECIMAL.has(r.currency) ? 1 : 0.02;
  if (r.subtotal !== null) {
    const expected = r.subtotal + (r.tax ?? 0) + (r.tip ?? 0);
    if (Math.abs(expected - r.total) > tol) {
      warnings.push(
        `subtotal + tax + tip = ${expected.toFixed(2)} but total is ${r.total.toFixed(2)}`,
      );
    }
    if (r.line_items.length > 0) {
      const items = r.line_items.reduce((s, i) => s + i.amount, 0);
      if (Math.abs(items - r.subtotal) > tol) {
        warnings.push(`line items add up to ${items.toFixed(2)} but subtotal is ${r.subtotal.toFixed(2)}`);
      }
    }
  }
  if (r.line_items.some((i) => i.is_alcohol) && !r.contains_alcohol) {
    warnings.push("a line item is marked as alcohol but contains_alcohol is false");
  }
  return warnings;
}
