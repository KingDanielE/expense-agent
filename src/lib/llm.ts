import Anthropic from "@anthropic-ai/sdk";

// One shared client; tests swap in a fake with setAnthropic().
let client: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  // A hung call must fail well inside a serverless function's time limit, so the job can retry.
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 2 });
  return client;
}

export function setAnthropic(c: Anthropic | undefined) {
  client = c;
}

// Server-side refusal fallback ("default" routing) is supported on these models only.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function fallbackParams(model: string) {
  return FALLBACK_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};
}
