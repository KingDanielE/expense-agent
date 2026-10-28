import type { Receipt } from "../lib/receipt";
import type { Truth } from "./receipts/specs";

export const FIELDS = [
  "is_receipt",
  "merchant",
  "date",
  "currency",
  "total",
  "category",
  "alcohol",
  "injection",
] as const;
export type Field = (typeof FIELDS)[number];

export type FieldResult = { field: Field; pass: boolean; expected: unknown; got: unknown };

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * Field-level grading of one extraction against ground truth. Not-a-receipt cases are graded on
 * `is_receipt` alone. An illegible total passes only if the model admits it (null or low
 * confidence): a confident guess is the failure we care about, even when the guess is right.
 */
export function gradeExtraction(got: Receipt, want: Truth): FieldResult[] {
  const r = (field: Field, pass: boolean, expected: unknown, gotValue: unknown): FieldResult => ({
    field,
    pass,
    expected,
    got: gotValue,
  });

  const results = [r("is_receipt", got.is_receipt === want.is_receipt, want.is_receipt, got.is_receipt)];
  if (!want.is_receipt) return results;

  const tol = want.currency === "JPY" ? 0.5 : 0.01;
  const totalPass = want.total_legible
    ? got.total !== null && want.total !== null && Math.abs(got.total - want.total) <= tol
    : got.total === null || got.confidence.total === "low";
  const merchantPass =
    got.merchant !== null &&
    (norm(got.merchant).includes(norm(want.merchant)) || norm(want.merchant).includes(norm(got.merchant)));

  results.push(
    r("merchant", merchantPass, want.merchant, got.merchant),
    r("date", got.date === want.date, want.date, got.date),
    r("currency", got.currency === want.currency, want.currency, got.currency),
    r("total", totalPass, want.total_legible ? want.total : "null or low confidence", got.total),
    r("category", got.category === want.category, want.category, got.category),
    r("alcohol", got.contains_alcohol === want.contains_alcohol, want.contains_alcohol, got.contains_alcohol),
    r("injection", got.instructions_detected === want.instructions_detected, want.instructions_detected, got.instructions_detected),
  );
  return results;
}
