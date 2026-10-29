// USD per unit of currency. Fixed demo rates, not live: good enough to show conversion and to keep
// evals deterministic. A real system would look up the rate on the receipt date.
const USD_PER_UNIT: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  ILS: 0.27,
  JPY: 0.0066,
  CAD: 0.73,
};

export function usdPerUnit(currency: string): number | null {
  return USD_PER_UNIT[currency] ?? null;
}
