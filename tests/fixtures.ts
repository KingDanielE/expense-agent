import type { Receipt } from "../src/lib/receipt";

export function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    is_receipt: true,
    merchant: "Blue Door Deli",
    date: "2026-10-14",
    currency: "USD",
    subtotal: 20,
    tax: 1.78,
    tip: 3,
    total: 24.78,
    line_items: [
      { description: "Turkey club", quantity: 1, amount: 12.5, is_alcohol: false },
      { description: "Caesar salad", quantity: 1, amount: 7.5, is_alcohol: false },
    ],
    category: "meals",
    contains_alcohol: false,
    instructions_detected: false,
    confidence: { merchant: "high", date: "high", currency: "high", total: "high" },
    notes: "",
    ...overrides,
  };
}
