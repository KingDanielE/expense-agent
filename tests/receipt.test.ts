import { describe, expect, it } from "vitest";
import { consistencyWarnings, Receipt, toMinor } from "../src/lib/receipt";
import { receipt } from "./fixtures";

describe("Receipt schema", () => {
  it("accepts a well-formed receipt", () => {
    expect(Receipt.safeParse(receipt()).success).toBe(true);
  });

  it.each([
    ["date in US format", { date: "10/14/2026" }],
    ["impossible date", { date: "2026-13-40" }],
    ["lowercase currency", { currency: "usd" }],
    ["negative total", { total: -4 }],
    ["null total with high confidence", { total: null }],
  ])("rejects %s", (_name, overrides) => {
    expect(Receipt.safeParse(receipt(overrides)).success).toBe(false);
  });

  it("allows a null total when the model says it can't read it", () => {
    const r = receipt({ total: null, confidence: { merchant: "high", date: "high", currency: "high", total: "low" } });
    expect(Receipt.safeParse(r).success).toBe(true);
  });

  it("doesn't require amounts on something that isn't a receipt", () => {
    const r = receipt({ is_receipt: false, total: null, date: null, subtotal: null });
    expect(Receipt.safeParse(r).success).toBe(true);
  });
});

describe("consistencyWarnings", () => {
  it("is quiet when the arithmetic adds up", () => {
    expect(consistencyWarnings(receipt())).toEqual([]);
  });

  it("flags a total that doesn't match subtotal + tax + tip", () => {
    const [w] = consistencyWarnings(receipt({ total: 34.78 }));
    expect(w).toContain("subtotal + tax + tip = 24.78 but total is 34.78");
  });

  it("flags line items that don't add up to the subtotal", () => {
    const warnings = consistencyWarnings(receipt({ subtotal: 25, total: 29.78 }));
    expect(warnings).toEqual(["line items add up to 20.00 but subtotal is 25.00"]);
  });

  it("flags an alcohol line item when contains_alcohol is false", () => {
    const items = [{ description: "Peroni", quantity: 2, amount: 20, is_alcohol: true }];
    expect(consistencyWarnings(receipt({ line_items: items }))).toContain(
      "a line item is marked as alcohol but contains_alcohol is false",
    );
  });
});

describe("toMinor", () => {
  it("converts to cents, and leaves zero-decimal currencies alone", () => {
    expect(toMinor(12.5, "USD")).toBe(1250);
    expect(toMinor(0.1 + 0.2, "EUR")).toBe(30);
    expect(toMinor(2860, "JPY")).toBe(2860);
  });
});
