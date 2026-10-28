import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_MODEL, ExtractionError, extractReceipt, type ExtractResult } from "../src/lib/extract";
import { FIELDS, type FieldResult, gradeExtraction } from "../src/eval/grade-extraction";
import type { Truth } from "../src/eval/receipts/specs";

// Usage: npm run extract -- [ids...] [--model claude-haiku-5-5] [--effort low] [--concurrency 4]
// Extracts the synthetic receipts, saves each result to out/extractions/<model>/<id>.json and
// grades them field by field against data/receipts/labels.json.

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string" },
    effort: { type: "string", default: "low" },
    concurrency: { type: "string", default: "4" },
  },
});

type Label = { id: string; file: string; tags: string[]; expected: Truth };
const dataDir = join(process.cwd(), "data", "receipts");
const { receipts } = JSON.parse(readFileSync(join(dataDir, "labels.json"), "utf8")) as { receipts: Label[] };
const selected = positionals.length ? receipts.filter((r) => positionals.includes(r.id)) : receipts;
if (selected.length === 0) throw new Error(`no receipts match ${positionals.join(", ")}`);

const model = values.model ?? process.env.EXTRACT_MODEL ?? DEFAULT_MODEL;
const effort = values.effort as "low" | "medium" | "high";
const outDir = join(process.cwd(), "out", "extractions", model);
mkdirSync(outDir, { recursive: true });

type Row = { label: Label; result?: ExtractResult; error?: string; grades: FieldResult[] };

async function one(label: Label): Promise<Row> {
  try {
    const result = await extractReceipt(join(dataDir, label.file), { model, effort });
    writeFileSync(join(outDir, `${label.id}.json`), JSON.stringify(result, null, 2) + "\n");
    return { label, result, grades: gradeExtraction(result.receipt, label.expected) };
  } catch (err) {
    if (!(err instanceof ExtractionError)) throw err;
    return { label, error: `${err.code}: ${err.message}`, grades: [] };
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      process.stdout.write(".");
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n");
  return out;
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "-");
const percentile = (xs: number[], p: number) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0;

async function main() {
  console.log(`Extracting ${selected.length} receipts with ${model} (effort ${effort})`);
  const rows = await pool(selected, Number(values.concurrency), one);

  console.log("\nid    result  failed fields");
  for (const row of rows) {
    const failed = row.grades.filter((g) => !g.pass);
    const status = row.error ? "ERROR" : failed.length ? "FAIL" : "ok";
    const detail = row.error
      ? row.error
      : failed.map((f) => `${f.field} (want ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.got)})`).join("; ");
    const warn = row.result?.warnings.length ? `  [warnings: ${row.result.warnings.join("; ")}]` : "";
    console.log(`${row.label.id.padEnd(5)} ${status.padEnd(7)} ${detail}${warn}`);
  }

  console.log("\nField accuracy");
  for (const field of FIELDS) {
    const graded = rows.flatMap((r) => r.grades.filter((g) => g.field === field));
    const passed = graded.filter((g) => g.pass).length;
    console.log(`  ${field.padEnd(11)} ${pct(passed, graded.length).padStart(4)}  (${passed}/${graded.length})`);
  }

  const ok = rows.filter((r) => r.result);
  const perfect = rows.filter((r) => r.result && r.grades.every((g) => g.pass)).length;
  const cost = ok.reduce((s, r) => s + (r.result!.costUsd ?? 0), 0);
  const latencies = ok.map((r) => r.result!.latencyMs);
  const retried = ok.filter((r) => r.result!.attempts > 1).length;
  console.log(`\nAll fields right: ${perfect}/${rows.length}   errors: ${rows.length - ok.length}   retried: ${retried}`);
  console.log(
    `Cost: $${cost.toFixed(4)} total, $${(cost / Math.max(ok.length, 1)).toFixed(4)} per receipt   ` +
      `Latency p50 ${(percentile(latencies, 0.5) / 1000).toFixed(1)}s, p95 ${(percentile(latencies, 0.95) / 1000).toFixed(1)}s`,
  );
  console.log(`Saved to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
