import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fallbackParams, getAnthropic } from "../lib/llm";
import { costUsd } from "../lib/pricing";
import { logStep } from "../runs/log";
import { callTool, SubmitReview, type ToolContext, TOOLS } from "./tools";

export const DEFAULT_REVIEW_MODEL = "claude-opus-5-5";
const MAX_TURNS = 6;

export class ReviewFailed extends Error {
  name = "ReviewFailed";
}

let prompt: string | undefined;
const systemPrompt = () =>
  (prompt ??= readFileSync(join(process.cwd(), "prompts", "review_expense.md"), "utf8"));

/**
 * The LLM reviewer: a tool-use loop that ends when the model calls `submit_review`. Every turn
 * and every tool call is logged. Throws `ReviewFailed` if the model refuses, never submits, or
 * submits something invalid; the caller then fails closed (sends the claim to a human).
 */
export async function reviewExpense(
  ctx: ToolContext,
  claim: unknown,
  opts: { model?: string } = {},
): Promise<SubmitReview> {
  const client = getAnthropic();
  const model = opts.model ?? process.env.REVIEW_MODEL ?? DEFAULT_REVIEW_MODEL;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Review this expense claim.\n\n<claim>\n${JSON.stringify(claim, null, 2)}\n</claim>`,
    },
  ];
  let nudged = false;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const started = Date.now();
    const response = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      system: systemPrompt(),
      tools: TOOLS,
      messages,
      output_config: { effort: "low" },
      ...fallbackParams(model),
    });
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    await logStep(ctx.runId, {
      type: "model_call",
      name: `review turn ${turn}`,
      actorId: ctx.actor.id,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: costUsd(response.model, {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      }),
      latencyMs: Date.now() - started,
      output: { stop_reason: response.stop_reason, text, tool_calls: uses.map((u) => u.name) },
    });

    if (response.stop_reason === "refusal") throw new ReviewFailed("the model declined to review this claim");
    // Append the whole turn, thinking blocks included: the history must stay append-only.
    messages.push({ role: "assistant", content: response.content });

    const submit = uses.find((u) => u.name === "submit_review");
    if (submit) {
      const parsed = SubmitReview.safeParse(submit.input);
      await logStep(ctx.runId, {
        type: "tool_call",
        name: "submit_review",
        actorId: ctx.actor.id,
        input: submit.input,
        output: parsed.success ? { ok: true } : { error: parsed.error.issues[0]?.message },
      });
      if (!parsed.success) throw new ReviewFailed("submit_review input was invalid");
      return parsed.data;
    }

    if (uses.length === 0) {
      if (nudged) throw new ReviewFailed("the model finished without calling submit_review");
      nudged = true;
      messages.push({ role: "user", content: "Finish by calling submit_review." });
      continue;
    }

    // Sequential, so the run log keeps the order the model asked for. All results go back in
    // one user message.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      const r = await callTool(ctx, u.name, u.input);
      results.push({ type: "tool_result", tool_use_id: u.id, content: r.content, is_error: r.isError });
    }
    messages.push({ role: "user", content: results });
  }
  throw new ReviewFailed(`no decision after ${MAX_TURNS} turns`);
}
