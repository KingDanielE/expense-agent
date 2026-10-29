import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

// npm run eval -- [config...] [--concurrency 4]
//   configs: oracle (free, always run first), opus, sonnet, haiku, haiku-opus
// Runs the full decision pipeline on all receipts in a separate database (expense_agent_eval)
// and writes evals/results/<config>.md and .json.

const EVAL_DB = "postgres://expense:expense@127.0.0.1:5434/expense_agent_eval";
process.env.DATABASE_URL = EVAL_DB; // before anything imports src/db

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { concurrency: { type: "string", default: "4" } },
});

async function main() {
  const { ensureDatabase } = await import("../src/db/ensure");
  await ensureDatabase(EVAL_DB);
  const { sql } = await import("../src/db");
  const { CONFIGS, reportMarkdown, runDecisionEval, summarize } = await import("../src/eval/run-decisions");

  const names = positionals.length ? positionals : ["opus"];
  for (const name of names) if (!CONFIGS[name]) throw new Error(`unknown config ${name}: ${Object.keys(CONFIGS).join(", ")}`);
  const outDir = join(process.cwd(), "evals", "results");
  mkdirSync(outDir, { recursive: true });

  try {
    // The oracle run checks the rules and harness against the labels, and gives the reference
    // amounts every model run is compared with.
    process.stdout.write("oracle ");
    const oracle = await runDecisionEval(CONFIGS.oracle, { concurrency: 1, onProgress: () => process.stdout.write(".") });
    const oracleSummary = summarize(CONFIGS.oracle, oracle);
    console.log(` ${oracleSummary.correct}/${oracleSummary.cases} correct`);
    if (oracleSummary.correct !== oracleSummary.cases) {
      console.log(reportMarkdown(oracleSummary, oracle));
      throw new Error("the oracle run doesn't match the labels: fix the rules or the labels before evaluating models");
    }

    for (const name of names.filter((n) => n !== "oracle")) {
      const config = CONFIGS[name];
      process.stdout.write(`${name} `);
      const cases = await runDecisionEval(config, {
        concurrency: Number(values.concurrency),
        onProgress: () => process.stdout.write("."),
      });
      const summary = summarize(config, cases, oracle);
      const md = reportMarkdown(summary, cases);
      writeFileSync(join(outDir, `${name}.md`), md);
      writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ summary, cases }, null, 2) + "\n");
      console.log(
        ` ${summary.correct}/${summary.cases} correct, ${summary.byVerdict.false_approval.length} false approvals, ` +
          `injections ${summary.injection.filter((i) => i.held).length}/${summary.injection.length}, ` +
          `$${summary.costPerClaimUsd.toFixed(4)}/claim, p95 ${(summary.latencyP95Ms / 1000).toFixed(1)}s`,
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
