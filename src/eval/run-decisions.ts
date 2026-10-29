import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { expenses, runSteps } from "../db/schema";
import { seed } from "../db/seed";
import { DEFAULT_MODEL } from "../lib/extract";
import { reviewExpense } from "../agent/review";
import type { ExtractResult } from "../lib/extract";
import { consistencyWarnings } from "../lib/receipt";
import type { PolicyDecision } from "../policy/engine";
import { deps, type ExpenseDecision, processRun, submitExpense } from "../runs/process";
import { type Approver, classify, type Verdict } from "./classify";
import { FIELDS, gradeExtraction, type Field } from "./grade-extraction";
import { expectedDecision, type ExpectedDecision, oracleReceipt, specById } from "./receipts/decisions";
import { REF_DATE, SPECS, truth } from "./receipts/specs";

export type EvalConfig = {
  name: string;
  extractModel: string;
  reviewModel: string;
  /** Perfect extraction and no reviewer: checks the rules and the harness, costs nothing. */
  oracle?: boolean;
};

export const CONFIGS: Record<string, EvalConfig> = {
  oracle: { name: "oracle", extractModel: "oracle", reviewModel: "none", oracle: true },
  opus: { name: "opus", extractModel: "claude-opus-5-5", reviewModel: "claude-opus-5-5" },
  sonnet: { name: "sonnet", extractModel: "claude-sonnet-5-5", reviewModel: "claude-sonnet-5-5" },
  haiku: { name: "haiku", extractModel: "claude-haiku-5-5", reviewModel: "claude-haiku-5-5" },
  "haiku-opus": { name: "haiku-opus", extractModel: "claude-haiku-5-5", reviewModel: "claude-opus-5-5" },
};

export type CaseResult = {
  id: string;
  tags: string[];
  expected: ExpectedDecision;
  outcome: PolicyDecision["outcome"] | null;
  approvers: Approver[];
  adjusted: string[];
  reimbursableUsdCents: number | null;
  reviewerFlags: string[];
  reviewFailed: string | null;
  verdict: Verdict;
  extractionMisses: Field[];
  costUsd: number;
  tokens: number;
  latencyMs: number;
  error: string | null;
};

const approverName = (a: PolicyDecision["approvals"][number]["approver"]): Approver =>
  a.kind === "employee" ? "manager" : a.role;

function oracleExtract(path: string): Promise<ExtractResult> {
  const receipt = oracleReceipt(specById(basename(path, ".png")));
  return Promise.resolve({
    receipt,
    warnings: consistencyWarnings(receipt),
    model: "oracle",
    servedBy: "oracle",
    attempts: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    latencyMs: 0,
  });
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Runs every receipt through the real pipeline (extract → rules → reviewer → final decision) as
 * its submitter, on the reference date, in a freshly seeded database. Ordinary receipts go first
 * so the duplicate (h07) has its original to match.
 */
export async function runDecisionEval(config: EvalConfig, opts: { concurrency?: number; onProgress?: () => void } = {}) {
  const saved = { ...deps };
  if (config.oracle) {
    deps.extract = oracleExtract;
    deps.review = async () => ({ flags: [], summary_for_employee: "", notes_for_approver: "" });
  } else {
    deps.extract = (path) =>
      import("../lib/extract").then((m) => m.extractReceipt(path, { model: config.extractModel }));
    deps.review = (ctx, claim) => reviewExpense(ctx, claim, { model: config.reviewModel });
  }

  try {
    const { ids } = await seed(db);
    const dir = join(process.cwd(), "data", "receipts");
    const start = Date.parse(`${REF_DATE}T12:00:00Z`);

    const one = async (index: number): Promise<CaseResult> => {
      const spec = SPECS[index];
      const started = Date.now();
      let error: string | null = null;
      const { expenseId, runId } = await submitExpense(ids[spec.submittedBy], join(dir, `${spec.id}.png`), {
        submittedAt: new Date(start + index * 1000),
      });
      try {
        await processRun(runId);
      } catch (err) {
        error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }
      const latencyMs = Date.now() - started;
      opts.onProgress?.();

      const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
      const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId));
      const decision = expense.decision as ExpenseDecision | null;
      const final = error ? undefined : decision?.final;
      const approvers = final?.approvals.map((s) => approverName(s.approver)) ?? [];
      const expected = expectedDecision(spec.id);
      const extraction = expense.extraction as { receipt: Parameters<typeof gradeExtraction>[0] } | null;
      const review = decision?.review;

      return {
        id: spec.id,
        tags: spec.tags,
        expected,
        outcome: final?.outcome ?? null,
        approvers,
        adjusted: final?.adjustments.map((a) => a.rule) ?? [],
        reimbursableUsdCents: final?.reimbursableUsdCents ?? null,
        reviewerFlags: review && "flags" in review ? review.flags.map((f) => `${f.approver}: ${f.reason}`) : [],
        reviewFailed: review && "failed" in review ? review.failed : null,
        verdict: classify(expected, final ? { outcome: final.outcome, approvers } : null),
        extractionMisses: extraction
          ? gradeExtraction(extraction.receipt, truth(spec)).filter((g) => !g.pass).map((g) => g.field)
          : [],
        costUsd: steps.reduce((s, x) => s + (x.costMicroUsd ?? 0) / 1e6, 0),
        tokens: steps.reduce((s, x) => s + (x.inputTokens ?? 0) + (x.outputTokens ?? 0), 0),
        latencyMs,
        error,
      };
    };

    const indexes = SPECS.map((_, i) => i);
    const concurrency = opts.concurrency ?? 4;
    const ordinary = await pool(indexes.filter((i) => SPECS[i].id.startsWith("n")), concurrency, one);
    const hard = await pool(indexes.filter((i) => SPECS[i].id.startsWith("h")), concurrency, one);
    return [...ordinary, ...hard];
  } finally {
    Object.assign(deps, saved);
  }
}

export function summarize(config: EvalConfig, cases: CaseResult[], oracle?: CaseResult[]) {
  const n = cases.length;
  const byVerdict = Object.fromEntries(
    (["false_approval", "missed_rule", "missing_approver", "wrong_block", "over_escalation", "error", "correct"] as const).map(
      (v) => [v, cases.filter((c) => c.verdict === v).map((c) => c.id)],
    ),
  ) as Record<Verdict, string[]>;
  const injection = cases.filter((c) => c.tags.includes("prompt_injection"));
  const oracleAmount = new Map(oracle?.map((c) => [c.id, c.reimbursableUsdCents]));
  const bothApproved = cases.filter((c) => c.outcome === "approve" && c.expected.outcome === "approve");
  const amountExact = bothApproved.filter((c) => !oracle || c.reimbursableUsdCents === oracleAmount.get(c.id));
  const extractionByField = Object.fromEntries(
    FIELDS.map((f) => [f, cases.filter((c) => c.extractionMisses.includes(f)).map((c) => c.id)]),
  );
  const latencies = cases.map((c) => c.latencyMs).sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(n - 1, Math.floor(p * n))] ?? 0;
  const ordinary = cases.filter((c) => c.id.startsWith("n"));
  const cost = cases.reduce((s, c) => s + c.costUsd, 0);

  return {
    config,
    cases: n,
    correct: byVerdict.correct.length,
    byVerdict,
    injection: injection.map((c) => ({ id: c.id, held: c.verdict === "correct", outcome: c.outcome, approvers: c.approvers })),
    amounts: { approvedBoth: bothApproved.length, exact: amountExact.length, off: bothApproved.filter((c) => !amountExact.includes(c)).map((c) => c.id) },
    ordinaryFlagged: ordinary.filter((c) => c.reviewerFlags.length > 0).map((c) => c.id),
    reviewFailures: cases.filter((c) => c.reviewFailed).map((c) => c.id),
    extractionByField,
    costUsd: cost,
    costPerClaimUsd: cost / n,
    tokens: cases.reduce((s, c) => s + c.tokens, 0),
    latencyP50Ms: pct(0.5),
    latencyP95Ms: pct(0.95),
  };
}

export type Summary = ReturnType<typeof summarize>;

export function reportMarkdown(s: Summary, cases: CaseResult[]): string {
  const ids = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  const lines = [
    `# Decision eval: ${s.config.name}`,
    "",
    `Extraction: \`${s.config.extractModel}\` · Reviewer: \`${s.config.reviewModel}\` · ${s.cases} receipts · reference date ${REF_DATE}`,
    "",
    `| Metric | Result |`,
    `|---|---|`,
    `| Correct decisions (outcome + approvers) | **${s.correct} / ${s.cases}** |`,
    `| False approvals (paid without a required check) | **${s.byVerdict.false_approval.length}** ${s.byVerdict.false_approval.length ? `(${ids(s.byVerdict.false_approval)})` : ""} |`,
    `| Missed rule / missing approver | ${s.byVerdict.missed_rule.length} / ${s.byVerdict.missing_approver.length} |`,
    `| Over-escalated / wrongly blocked | ${s.byVerdict.over_escalation.length} / ${s.byVerdict.wrong_block.length} |`,
    `| Prompt injections held | ${s.injection.filter((i) => i.held).length} / ${s.injection.length} |`,
    `| Reimbursed amount exact (vs perfect extraction) | ${s.amounts.exact} / ${s.amounts.approvedBoth} |`,
    `| Ordinary receipts the reviewer flagged | ${s.ordinaryFlagged.length} / 20 |`,
    `| Reviewer failures (fell back to a human) | ${s.reviewFailures.length} |`,
    `| Errors | ${s.byVerdict.error.length} |`,
    `| Cost per claim | $${s.costPerClaimUsd.toFixed(4)} (total $${s.costUsd.toFixed(2)}) |`,
    `| Latency per claim p50 / p95 | ${(s.latencyP50Ms / 1000).toFixed(1)}s / ${(s.latencyP95Ms / 1000).toFixed(1)}s |`,
    "",
    "## Not correct",
    "",
    "| Receipt | Tags | Expected | Got | Verdict | Extraction misses | Reviewer flags |",
    "|---|---|---|---|---|---|---|",
    ...cases
      .filter((c) => c.verdict !== "correct")
      .map((c) => {
        const want = `${c.expected.outcome}${c.expected.approvers ? ` (${c.expected.approvers.join(", ")})` : ""}`;
        const got = c.error ? `error: ${c.error}` : `${c.outcome}${c.approvers.length ? ` (${c.approvers.join(", ")})` : ""}`;
        return `| ${c.id} | ${c.tags.join(", ")} | ${want} | ${got} | ${c.verdict} | ${c.extractionMisses.join(", ") || "—"} | ${c.reviewerFlags.join("; ").replace(/\|/g, "/") || "—"} |`;
      }),
    "",
    "## Extraction misses by field",
    "",
    ...Object.entries(s.extractionByField).map(([f, xs]) => `- ${f}: ${ids(xs as string[])}`),
    "",
  ];
  return lines.join("\n");
}

export { DEFAULT_MODEL };
