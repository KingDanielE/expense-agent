import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, asc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { reviewExpense, ReviewFailed } from "../agent/review";
import type { SubmitReview } from "../agent/tools";
import { type Actor, can } from "../auth/permissions";
import { db } from "../db";
import { approvals, employees, type ExpenseStatus, expenses, runs } from "../db/schema";
import { enqueue } from "../jobs/queue";
import { ExtractionError, extractReceipt } from "../lib/extract";
import { resolveFile } from "../lib/paths";
import { usdPerUnit } from "../lib/fx";
import { type Receipt, toMinor } from "../lib/receipt";
import { evaluate, type Outcome, type PolicyDecision, type ReviewerFlag, withReviewerFlags } from "../policy/engine";
import { logStep } from "./log";

/**
 * An expense run is a small state machine with a durable cursor (`runs.stage`):
 *
 *   extract → decide → review → finalize → await_approval → done
 *
 * Each stage commits its result together with the next stage name, so a worker that dies
 * mid-run resumes where it stopped and never redoes a committed stage. `await_approval` parks the
 * run until a human decides; `decideApproval` enqueues `resume_run`.
 */

export type ExpenseDecision = {
  policy: PolicyDecision;
  review?: SubmitReview | { failed: string } | null;
  final?: PolicyDecision;
};

const STATUS: Record<Outcome, ExpenseStatus> = {
  approve: "approved",
  needs_approval: "waiting_approval",
  needs_info: "needs_info",
  reject: "rejected",
};

export class PermissionDenied extends Error {
  name = "PermissionDenied";
}

const actorOf = (e: typeof employees.$inferSelect): Actor => ({
  id: e.id,
  companyId: e.companyId,
  role: e.role,
  managerId: e.managerId,
});

/**
 * The model-backed steps, swappable for evals (e.g. a perfect "oracle" extractor, or no
 * reviewer) without touching the run machinery.
 */
export const deps = {
  extract: (path: string) => extractReceipt(path),
  review: reviewExpense,
};

export async function submitExpense(
  employeeId: string,
  filePath: string,
  opts: { submittedAt?: Date; visitor?: string } = {},
) {
  const sha = createHash("sha256").update(readFileSync(resolveFile(filePath))).digest("hex");
  return db.transaction(async (tx) => {
    const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId));
    if (!employee) throw new Error(`no employee ${employeeId}`);
    const [expense] = await tx
      .insert(expenses)
      .values({
        companyId: employee.companyId,
        employeeId,
        filePath,
        fileSha256: sha,
        submittedAt: opts.submittedAt,
        visitor: opts.visitor,
      })
      .returning();
    const [run] = await tx.insert(runs).values({ expenseId: expense.id, actingFor: employeeId }).returning();
    await logStep(run.id, { type: "status", name: "submitted", actorId: employeeId, input: { file: filePath, sha256: sha } }, tx);
    await enqueue(tx, "process_run", { runId: run.id }, { dedupeKey: `run:${run.id}` });
    return { expenseId: expense.id, runId: run.id };
  });
}

async function load(runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error(`no run ${runId}`);
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, run.expenseId));
  const [submitter] = await db.select().from(employees).where(eq(employees.id, expense.employeeId));
  return { run, expense, submitter };
}

async function setStage(runId: string, stage: string, tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  await tx.update(runs).set({ stage, updatedAt: new Date() }).where(eq(runs.id, runId));
}

export async function processRun(runId: string): Promise<void> {
  const { run: initial } = await load(runId);
  if (initial.status === "completed" || initial.status === "failed" || initial.status === "waiting_approval") return;
  await db.update(runs).set({ status: "running", updatedAt: new Date() }).where(eq(runs.id, runId));

  while (true) {
    const { run, expense, submitter } = await load(runId);
    switch (run.stage) {
      case "extract":
        await extractStage(runId, expense);
        break;
      case "decide":
        await decideStage(runId, expense, submitter);
        break;
      case "review":
        await reviewStage(runId, expense, submitter);
        break;
      case "finalize":
        await finalizeStage(runId, expense);
        break;
      default:
        return; // await_approval or done
    }
  }
}

async function extractStage(runId: string, expense: typeof expenses.$inferSelect) {
  try {
    const result = await deps.extract(expense.filePath);
    const r = result.receipt;
    await db.transaction(async (tx) => {
      await tx
        .update(expenses)
        .set({
          status: "processing",
          extraction: { receipt: r, warnings: result.warnings },
          category: r.category,
          expenseDate: r.date,
          merchant: r.merchant,
          currency: r.currency,
          totalMinor: r.total !== null && r.currency ? toMinor(r.total, r.currency) : null,
          updatedAt: new Date(),
        })
        .where(eq(expenses.id, expense.id));
      await logStep(
        runId,
        {
          type: "extract",
          name: "extract_receipt",
          model: result.servedBy,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
          output: { receipt: r, warnings: result.warnings, attempts: result.attempts },
        },
        tx,
      );
      await setStage(runId, "decide", tx);
    });
  } catch (err) {
    if (!(err instanceof ExtractionError)) throw err; // API trouble: let the job retry
    const policy: PolicyDecision = {
      outcome: "needs_info",
      claimedUsdCents: null,
      reimbursableUsdCents: null,
      adjustments: [],
      approvals: [],
      findings: [{ rule: "ILLEGIBLE", outcome: "needs_info", text: `We couldn't read this receipt (${err.code}).` }],
    };
    await db.transaction(async (tx) => {
      await tx.update(expenses).set({ decision: { policy, final: policy } satisfies ExpenseDecision }).where(eq(expenses.id, expense.id));
      await logStep(runId, { type: "extract", name: "extract_receipt", output: { error: err.code, message: err.message } }, tx);
      await setStage(runId, "finalize", tx);
    });
  }
}

async function decideStage(
  runId: string,
  expense: typeof expenses.$inferSelect,
  submitter: typeof employees.$inferSelect,
) {
  const { receipt, warnings } = expense.extraction as { receipt: Receipt; warnings: string[] };

  // Facts the rules need. Code looks these up itself rather than trusting the model to.
  const rate = receipt.currency ? usdPerUnit(receipt.currency) : null;
  await logStep(runId, { type: "check", name: "fx_rate", input: { currency: receipt.currency }, output: { usd_per_unit: rate } });

  // Company-wide, so two people can't claim the same dinner. Returns only the other expense's id.
  let duplicateOf: string | null = null;
  if (expense.expenseDate && expense.totalMinor !== null && expense.merchant) {
    const [dup] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(
        and(
          eq(expenses.companyId, expense.companyId),
          ne(expenses.id, expense.id),
          eq(expenses.expenseDate, expense.expenseDate),
          eq(expenses.totalMinor, expense.totalMinor),
          eq(expenses.currency, expense.currency!),
          sql`lower(${expenses.merchant}) = lower(${expense.merchant})`,
          lt(expenses.submittedAt, expense.submittedAt),
          inArray(expenses.status, ["processing", "waiting_approval", "approved"]),
        ),
      )
      .limit(1);
    duplicateOf = dup?.id ?? null;
  }
  await logStep(runId, {
    type: "check",
    name: "duplicate_check",
    input: { merchant: expense.merchant, date: expense.expenseDate, total_minor: expense.totalMinor },
    output: { duplicate_of: duplicateOf },
  });

  let mealsSpent = 0;
  if (receipt.category === "meals" && expense.expenseDate) {
    const [row] = await db
      .select({ cents: sql<string>`coalesce(sum(${expenses.reimbursableUsdCents}), 0)` })
      .from(expenses)
      .where(
        and(
          eq(expenses.employeeId, expense.employeeId),
          ne(expenses.id, expense.id),
          eq(expenses.category, "meals"),
          eq(expenses.expenseDate, expense.expenseDate),
          inArray(expenses.status, ["waiting_approval", "approved"]),
        ),
      );
    mealsSpent = Number(row.cents);
    await logStep(runId, { type: "check", name: "meals_same_day", input: { date: expense.expenseDate }, output: { usd_cents: mealsSpent } });
  }

  const policy = evaluate({
    receipt,
    warnings,
    submitter: { id: submitter.id, role: submitter.role, managerId: submitter.managerId },
    usdPerUnit: rate,
    duplicateOf,
    mealsSpentSameDayUsdCents: mealsSpent,
    today: expense.submittedAt.toISOString().slice(0, 10),
  });
  await db.transaction(async (tx) => {
    await tx.update(expenses).set({ decision: { policy } satisfies ExpenseDecision }).where(eq(expenses.id, expense.id));
    await logStep(runId, { type: "policy", name: "policy_engine", output: policy }, tx);
    await setStage(runId, "review", tx);
  });
}

async function reviewStage(
  runId: string,
  expense: typeof expenses.$inferSelect,
  submitter: typeof employees.$inferSelect,
) {
  const { policy } = expense.decision as ExpenseDecision;
  let review: ExpenseDecision["review"] = null;
  let flags: ReviewerFlag[] = [];

  // Rejections and requests for a clearer copy come from the rules alone; nothing to review.
  if (policy.outcome === "approve" || policy.outcome === "needs_approval") {
    const { receipt, warnings } = expense.extraction as { receipt: Receipt; warnings: string[] };
    try {
      review = await deps.review(
        { runId, actor: actorOf(submitter) },
        {
          acting_for: { name: submitter.name, email: submitter.email, title: submitter.title, role: submitter.role },
          receipt,
          extraction_warnings: warnings,
          policy_result: policy,
        },
      );
      flags = review.flags;
    } catch (err) {
      if (!(err instanceof ReviewFailed)) throw err;
      // Fail closed: if the reviewer can't finish, a person looks at the claim.
      review = { failed: err.message };
      flags = [{ approver: "manager", reason: "The automated review didn't finish, so a person should check this claim." }];
    }
  }

  const final = withReviewerFlags(policy, flags, { id: submitter.id, role: submitter.role, managerId: submitter.managerId });
  await db.transaction(async (tx) => {
    await tx
      .update(expenses)
      .set({ decision: { policy, review, final } satisfies ExpenseDecision })
      .where(eq(expenses.id, expense.id));
    await logStep(runId, { type: "decision", name: "final_decision", output: { outcome: final.outcome, flags, approvals: final.approvals } }, tx);
    await setStage(runId, "finalize", tx);
  });
}

async function finalizeStage(runId: string, expense: typeof expenses.$inferSelect) {
  const { final } = expense.decision as ExpenseDecision;
  const decision = final!;
  await db.transaction(async (tx) => {
    await tx
      .update(expenses)
      .set({
        status: STATUS[decision.outcome],
        reimbursableUsdCents: decision.reimbursableUsdCents,
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, expense.id));

    if (decision.outcome === "needs_approval") {
      const rows = decision.approvals.map((step, i) => ({
        expenseId: expense.id,
        runId,
        seq: i + 1,
        approverId: step.approver.kind === "employee" ? step.approver.employeeId : null,
        approverRole: step.approver.kind === "role" ? step.approver.role : null,
        reason: step.reason,
        status: i === 0 ? ("pending" as const) : ("waiting" as const),
      }));
      const inserted = await tx.insert(approvals).values(rows).returning();
      await logStep(runId, { type: "approval_requested", name: "approval_requested", output: inserted[0] }, tx);
      await tx.update(runs).set({ status: "waiting_approval", stage: "await_approval", updatedAt: new Date() }).where(eq(runs.id, runId));
    } else {
      await logStep(runId, { type: "status", name: "completed", output: { outcome: decision.outcome } }, tx);
      await tx.update(runs).set({ status: "completed", stage: "done", updatedAt: new Date() }).where(eq(runs.id, runId));
    }
  });
}

/** A human decides one approval step. Denied attempts are logged too. */
export async function decideApproval(
  approvalId: string,
  actorId: string,
  decision: "approved" | "rejected",
  comment = "",
) {
  const denied = await db.transaction(async (tx) => {
    const [approval] = await tx.select().from(approvals).where(eq(approvals.id, approvalId)).for("update");
    if (!approval) throw new Error(`no approval ${approvalId}`);
    const [expense] = await tx.select().from(expenses).where(eq(expenses.id, approval.expenseId));
    const [owner] = await tx.select().from(employees).where(eq(employees.id, expense.employeeId));
    const [actor] = await tx.select().from(employees).where(eq(employees.id, actorId));
    if (!actor) throw new Error(`no employee ${actorId}`);

    const verdict = can(actorOf(actor), {
      action: "expense.decide",
      owner: { id: owner.id, companyId: owner.companyId, managerId: owner.managerId },
      approval,
    });
    await logStep(
      approval.runId,
      {
        type: "approval_decision",
        name: decision,
        actorId,
        permission: verdict.allowed ? "allowed" : "denied",
        input: { approval_id: approvalId, seq: approval.seq, comment },
        output: verdict.allowed ? { status: decision } : { error: verdict.reason },
      },
      tx,
    );
    if (!verdict.allowed) return verdict.reason;

    await tx
      .update(approvals)
      .set({ status: decision, decidedBy: actorId, decidedAt: new Date(), comment })
      .where(eq(approvals.id, approvalId));
    await enqueue(tx, "resume_run", { runId: approval.runId }, { dedupeKey: `resume:${approvalId}` });
    return null;
  });
  if (denied) throw new PermissionDenied(denied);
}

/** Moves a parked run along after an approval decision. Idempotent. */
export async function resumeRun(runId: string) {
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update");
    if (run.stage !== "await_approval") return;
    const chain = await tx.select().from(approvals).where(eq(approvals.runId, runId)).orderBy(asc(approvals.seq));
    if (chain.some((a) => a.status === "pending")) return;

    const finish = async (status: ExpenseStatus, outcome: string) => {
      await tx.update(expenses).set({ status, updatedAt: new Date() }).where(eq(expenses.id, run.expenseId));
      await tx.update(runs).set({ status: "completed", stage: "done", updatedAt: new Date() }).where(eq(runs.id, runId));
      await logStep(runId, { type: "status", name: "completed", output: { outcome } }, tx);
    };

    if (chain.some((a) => a.status === "rejected")) return finish("rejected", "rejected by approver");
    const next = chain.find((a) => a.status === "waiting");
    if (!next) return finish("approved", "approved by all approvers");
    await tx.update(approvals).set({ status: "pending" }).where(eq(approvals.id, next.id));
    await logStep(runId, { type: "approval_requested", name: "approval_requested", output: { ...next, status: "pending" } }, tx);
  });
}

/** Called when a job gives up for good, so the run doesn't sit in "running" forever. */
export async function failRun(runId: string, error: string) {
  await db.update(runs).set({ status: "failed", error, updatedAt: new Date() }).where(eq(runs.id, runId));
  await logStep(runId, { type: "status", name: "failed", output: { error } });
}
