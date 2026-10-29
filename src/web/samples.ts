import { SPECS } from "../eval/receipts/specs";

const TAG_TEXT: Record<string, string> = {
  handwritten_tip: "handwritten tip",
  tip_pushes_over_limit: "over the meal limit",
  foreign_currency: "foreign currency",
  eu_number_format: "European number format",
  ambiguous_date: "ambiguous date",
  blurry_total: "blurred total",
  alcohol: "alcohol on the bill",
  prompt_injection: "prompt injection",
  duplicate: "duplicate of n03",
  older_than_90_days: "older than 90 days",
  not_a_receipt: "a menu, not a receipt",
  equipment_over_500: "equipment over $500",
  flight_over_800: "flight over $800",
  over_1000: "over $1,000",
  manager_submitter: "manager's claim",
  zero_decimal_currency: "yen",
  rotated: "rotated",
  noisy: "noisy photo",
  software_over_limit: "software over $50",
  tip_over_20pct: "tip over 20%",
  tool_name_injection: "fake system notice",
  line_item_injection: "injection in a line item",
  manager_limit: "manager meal limit",
  arithmetic_mismatch: "numbers don't add up",
  personal_items: "personal items",
};

/** The synthetic receipts, labelled for the sample picker. */
export const SAMPLES = SPECS.map((s) => ({
  id: s.id,
  merchant: s.merchant,
  submittedBy: s.submittedBy,
  label: s.tags.includes("ordinary")
    ? `${s.merchant} (${s.category.replace("_", " ")})`
    : `${s.merchant}: ${s.tags.map((t) => TAG_TEXT[t] ?? t).join(", ")}`,
}));
