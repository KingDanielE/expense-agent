import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { costUsd, type Usage } from "./pricing";
import { consistencyWarnings, Receipt, ReceiptExtraction } from "./receipt";

export const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_ATTEMPTS = 2;

// Server-side refusal fallback ("default" routing) is supported on these models only.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const MEDIA_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
} as const;

export type ExtractionErrorCode = "unsupported_file" | "refused" | "invalid_output";

export class ExtractionError extends Error {
  constructor(
    readonly code: ExtractionErrorCode,
    message: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

export type ExtractResult = {
  receipt: Receipt;
  warnings: string[];
  model: string; // requested
  servedBy: string; // may differ if a refusal fell back to another model
  attempts: number;
  usage: Usage;
  costUsd: number | null;
  latencyMs: number;
};

export type ExtractOptions = {
  model?: string;
  client?: Anthropic;
  effort?: "low" | "medium" | "high";
};

let prompt: string | undefined;
function systemPrompt(): string {
  prompt ??= readFileSync(join(process.cwd(), "prompts", "extract_receipt.md"), "utf8");
  return prompt;
}

function fileBlock(path: string): Anthropic.Beta.BetaContentBlockParam {
  const ext = extname(path).toLowerCase() as keyof typeof MEDIA_TYPES;
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) throw new ExtractionError("unsupported_file", `unsupported file type: ${ext || path}`, 0);
  const data = readFileSync(path).toString("base64");
  if (mediaType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: mediaType, data } };
  }
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

/**
 * Receipt image or PDF → validated `Receipt`.
 *
 * The model's output is parsed against `ReceiptExtraction` (structured outputs), then checked
 * again against the stricter `Receipt` schema. One retry, told what was wrong; after that a
 * typed `ExtractionError`. Arithmetic is never trusted to the model: `warnings` lists
 * inconsistencies for the policy engine to act on.
 */
export async function extractReceipt(path: string, opts: ExtractOptions = {}): Promise<ExtractResult> {
  const model = opts.model ?? process.env.EXTRACT_MODEL ?? DEFAULT_MODEL;
  const client = opts.client ?? new Anthropic();
  const file = fileBlock(path);
  const started = Date.now();
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let servedBy = model;
  let problem = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const instruction = problem
      ? `Extract this receipt. Your previous answer was rejected: ${problem}. Fix those fields.`
      : "Extract this receipt.";

    let response;
    try {
      response = await client.beta.messages.parse({
        model,
        max_tokens: 8000,
        system: systemPrompt(),
        output_config: { format: betaZodOutputFormat(ReceiptExtraction), effort: opts.effort ?? "low" },
        messages: [{ role: "user", content: [file, { type: "text", text: instruction }] }],
        ...(FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      });
    } catch (err) {
      // API errors (auth, rate limits after SDK retries, 400s) are not ours to paper over.
      if (err instanceof Anthropic.APIError) throw err;
      problem = `output was not valid JSON for the schema (${(err as Error).message})`;
      continue;
    }

    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
    servedBy = response.model;

    if (response.stop_reason === "refusal") {
      throw new ExtractionError("refused", `model declined: ${response.stop_details?.category ?? "unknown"}`, attempt);
    }
    if (response.stop_reason === "max_tokens") {
      problem = "the answer was cut off; keep notes short";
      continue;
    }

    const checked = Receipt.safeParse(response.parsed_output);
    if (checked.success) {
      return {
        receipt: checked.data,
        warnings: consistencyWarnings(checked.data),
        model,
        servedBy,
        attempts: attempt,
        usage,
        costUsd: costUsd(servedBy, usage),
        latencyMs: Date.now() - started,
      };
    }
    problem = checked.error.issues.map((i) => `${i.path.join(".") || "output"}: ${i.message}`).join("; ");
  }

  throw new ExtractionError("invalid_output", problem, MAX_ATTEMPTS);
}
