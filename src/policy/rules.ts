import type { Role } from "../db/schema";
import type { Category } from "../lib/receipt";

// The numbers from policy/policy.md, as code. Keep the two in sync: the policy text is what the
// agent and employees read, these constants are what decides.

export const MAX_AGE_DAYS = 90;
export const FINANCE_APPROVAL_OVER_CENTS = 100_000; // $1,000
export const MAX_TIP_RATE = 0.2;

export function mealLimitCents(role: Role): number {
  return role === "employee" ? 7_500 : 12_000;
}

export const CAPS_CENTS: Partial<Record<Category, number>> = {
  lodging: 30_000,
  office_supplies: 10_000,
};

export const APPROVAL_OVER_CENTS: Partial<Record<Category, number>> = {
  software: 5_000,
  equipment: 50_000,
};
export const FLIGHT_APPROVAL_OVER_CENTS = 80_000;

export const RULES = {
  NOT_RECEIPT: "This doesn't look like a receipt or invoice.",
  ILLEGIBLE: "The total or date can't be read reliably.",
  UNKNOWN_CURRENCY: "The currency is unknown, so it can't be converted to USD.",
  DUPLICATE: "This receipt has already been submitted.",
  TOO_OLD: `Receipts must be submitted within ${MAX_AGE_DAYS} days.`,
  FUTURE_DATE: "The receipt is dated in the future.",
  TIP_CAP: "Tips above 20% of the subtotal are not reimbursed.",
  ALCOHOL: "Alcohol, and its share of tax and tip, is not reimbursed.",
  MEAL_LIMIT: "Over the daily meal limit.",
  CAP: "Over the category limit.",
  NOTHING_LEFT: "Nothing on this receipt is reimbursable.",
  FLIGHT: "Flights over $800 need manager approval.",
  CATEGORY_APPROVAL: "Over the category approval threshold.",
  OTHER: "Expenses in the 'other' category always need manager approval.",
  FINANCE: "Expenses over $1,000 need Finance approval.",
  ARITHMETIC: "The receipt's numbers don't add up.",
  INSTRUCTIONS: "The receipt contains text addressed to the reviewer.",
  REVIEWER_FLAG: "Flagged by the AI reviewer.",
} as const;
export type RuleId = keyof typeof RULES;

export const FLIGHT_PATTERN = /airline|airways|\bflight\b|main cabin|economy|business class|boarding/i;
