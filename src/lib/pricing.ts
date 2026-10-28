// USD per million tokens (input, output). Used for cost reporting in the run log and evals.
const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export type Usage = { inputTokens: number; outputTokens: number };

export function costUsd(model: string, usage: Usage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  return (usage.inputTokens * price[0] + usage.outputTokens * price[1]) / 1_000_000;
}
