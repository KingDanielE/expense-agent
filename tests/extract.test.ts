import type Anthropic from "@anthropic-ai/sdk";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ExtractionError, extractReceipt } from "../src/lib/extract";
import { receipt } from "./fixtures";

const RECEIPT = join(process.cwd(), "data", "receipts", "n01.png");

type FakeResponse = { parsed_output: unknown; stop_reason?: string; model?: string };

/** A stand-in for the Anthropic client: returns the scripted responses in order. */
function fakeClient(...responses: (FakeResponse | Error)[]) {
  const parse = vi.fn(async (params: Record<string, unknown>) => {
    const next = responses.shift();
    if (!next) throw new Error("no more scripted responses");
    if (next instanceof Error) throw next;
    return {
      model: next.model ?? (params.model as string),
      stop_reason: next.stop_reason ?? "end_turn",
      stop_details: null,
      usage: { input_tokens: 1000, output_tokens: 200 },
      parsed_output: next.parsed_output,
    };
  });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

describe("extractReceipt", () => {
  it("returns the validated receipt with usage and cost", async () => {
    const { client, parse } = fakeClient({ parsed_output: receipt() });
    const result = await extractReceipt(RECEIPT, { client, model: "claude-opus-5-5" });

    expect(result.receipt.total).toBe(24.78);
    expect(result.attempts).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 200 });
    expect(result.costUsd).toBeCloseTo((1000 * 4 + 200 * 20) / 1e6);

    const params = parse.mock.calls[0][0];
    expect(params.output_config).toMatchObject({ effort: "low" });
    expect(params.fallbacks).toBe("default");
    const content = (params.messages as { content: { type: string }[] }[])[0].content;
    expect(content[0].type).toBe("image");
  });

  it("doesn't ask for refusal fallbacks on models that don't support them", async () => {
    const { client, parse } = fakeClient({ parsed_output: receipt() });
    await extractReceipt(RECEIPT, { client, model: "claude-haiku-5-5" });
    expect(parse.mock.calls[0][0].fallbacks).toBeUndefined();
    expect(parse.mock.calls[0][0].betas).toBeUndefined();
  });

  it("retries once and tells the model what was wrong", async () => {
    const { client, parse } = fakeClient(
      { parsed_output: receipt({ date: "10/14/2026" }) },
      { parsed_output: receipt() },
    );
    const result = await extractReceipt(RECEIPT, { client });

    expect(result.attempts).toBe(2);
    expect(result.usage.inputTokens).toBe(2000);
    const retry = (parse.mock.calls[1][0].messages as { content: { type: string; text?: string }[] }[])[0];
    expect(retry.content[1].text).toContain("date: date must be YYYY-MM-DD");
  });

  it("retries when the output doesn't parse as JSON", async () => {
    const { client } = fakeClient(new SyntaxError("Unexpected end of JSON input"), { parsed_output: receipt() });
    expect((await extractReceipt(RECEIPT, { client })).attempts).toBe(2);
  });

  it("gives up with a typed error after two bad answers", async () => {
    const bad = { parsed_output: receipt({ currency: "dollars" }) };
    const { client } = fakeClient(bad, { ...bad });
    await expect(extractReceipt(RECEIPT, { client })).rejects.toMatchObject({
      name: "ExtractionError",
      code: "invalid_output",
      attempts: 2,
    });
  });

  it("stops on a refusal instead of retrying", async () => {
    const { client, parse } = fakeClient({ parsed_output: null, stop_reason: "refusal" });
    await expect(extractReceipt(RECEIPT, { client })).rejects.toMatchObject({ code: "refused" });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("reports the model that actually answered", async () => {
    const { client } = fakeClient({ parsed_output: receipt(), model: "claude-opus-4-8" });
    const result = await extractReceipt(RECEIPT, { client, model: "claude-opus-5-5" });
    expect(result.servedBy).toBe("claude-opus-4-8");
  });

  it("rejects file types it can't send", async () => {
    const { client } = fakeClient();
    await expect(extractReceipt("receipt.txt", { client })).rejects.toBeInstanceOf(ExtractionError);
  });

  it("flags inconsistent arithmetic as warnings, not errors", async () => {
    const { client } = fakeClient({ parsed_output: receipt({ total: 99 }) });
    const result = await extractReceipt(RECEIPT, { client });
    expect(result.warnings).toHaveLength(1);
  });
});
