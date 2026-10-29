import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMPLOYEES } from "../src/db/seed-data";
import { gradeExtraction } from "../src/eval/grade-extraction";
import { money } from "../src/eval/receipts/render";
import { amounts, SPECS, truth } from "../src/eval/receipts/specs";
import { receipt } from "./fixtures";

describe("synthetic receipt set", () => {
  it("has 42 receipts with unique ids, submitted by seeded employees", () => {
    expect(SPECS).toHaveLength(42);
    expect(new Set(SPECS.map((s) => s.id)).size).toBe(42);
    const emails = new Set(EMPLOYEES.map((e) => e.email));
    for (const s of SPECS) expect(emails.has(s.submittedBy), s.id).toBe(true);
  });

  it("matches the committed labels.json (run `npm run receipts:generate` after changing specs)", () => {
    const labels = JSON.parse(readFileSync(join(process.cwd(), "data", "receipts", "labels.json"), "utf8"));
    const byId = Object.fromEntries(labels.receipts.map((l: { id: string; expected: unknown }) => [l.id, l.expected]));
    for (const s of SPECS) expect(byId[s.id], s.id).toEqual(truth(s));
  });

  it("has no accidental duplicates (same merchant, date and total) besides h07", () => {
    const seen = new Map<string, string>();
    for (const s of SPECS.filter((x) => !x.duplicateOf && !x.notReceipt)) {
      const t = truth(s);
      const key = `${t.merchant}|${t.date}|${t.total}`;
      expect(seen.get(key), `${s.id} duplicates ${seen.get(key)}`).toBeUndefined();
      seen.set(key, s.id);
    }
  });

  it("makes the duplicate the same purchase as its original", () => {
    const dup = SPECS.find((s) => s.duplicateOf)!;
    const original = SPECS.find((s) => s.id === dup.duplicateOf)!;
    expect(truth(dup)).toEqual(truth(original));
    expect(dup.layout).not.toEqual(original.layout);
  });

  it("keeps the arithmetic-mismatch receipt's printed total", () => {
    const s = SPECS.find((x) => x.tags.includes("arithmetic_mismatch"))!;
    const a = amounts(s);
    expect(a.total).toBe(42.66);
    expect(a.subtotal + a.tax).not.toBeCloseTo(a.total);
  });

  it("formats money per currency and locale", () => {
    expect(money(1234.5, "USD")).toBe("$1,234.50");
    expect(money(1234.5, "EUR", "eu")).toBe("1.234,50 €");
    expect(money(2860, "JPY")).toBe("¥2,860");
  });
});

describe("gradeExtraction", () => {
  const blurry = SPECS.find((s) => s.tags.includes("blurry_total"))!;
  const want = { ...truth(blurry), merchant: "Blue Door Deli", date: "2026-10-14", currency: "USD" as const };
  const low = { merchant: "high", date: "high", currency: "high", total: "low" } as const;

  it("passes an illegible total only when the model admits it", () => {
    const total = (r: ReturnType<typeof receipt>) =>
      gradeExtraction(r, want).find((g) => g.field === "total")!.pass;
    expect(total(receipt({ total: null, confidence: low }))).toBe(true);
    expect(total(receipt({ total: 22.32, confidence: low }))).toBe(true);
    expect(total(receipt({ total: 22.32 }))).toBe(false); // right number, but a confident guess
  });

  it("grades a non-receipt on is_receipt alone", () => {
    const menu = truth(SPECS.find((s) => s.notReceipt)!);
    expect(gradeExtraction(receipt({ is_receipt: false }), menu)).toEqual([
      { field: "is_receipt", pass: true, expected: false, got: false },
    ]);
  });

  it("matches merchants loosely (case, accents, punctuation)", () => {
    const cafe = truth(SPECS.find((s) => s.merchant === "Café Lumière")!);
    const merchant = gradeExtraction(receipt({ merchant: "CAFE LUMIERE" }), cafe).find((g) => g.field === "merchant")!;
    expect(merchant.pass).toBe(true);
  });
});
