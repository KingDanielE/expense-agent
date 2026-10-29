import type { ExpenseStatus } from "../db/schema";

export const usd = (cents: number | null | undefined) =>
  cents == null
    ? "—"
    : `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ZERO_DECIMAL = new Set(["JPY"]);
export function money(minor: number | null, currency: string | null) {
  if (minor == null || !currency) return "—";
  const major = ZERO_DECIMAL.has(currency) ? minor : minor / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(major);
}

export const when = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const STATUS_LABEL: Record<ExpenseStatus, string> = {
  submitted: "Submitted",
  processing: "Processing",
  waiting_approval: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
  needs_info: "Needs a clearer receipt",
};
