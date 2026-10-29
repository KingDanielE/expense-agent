import type Anthropic from "@anthropic-ai/sdk";
import { asc, eq } from "drizzle-orm";
import { join } from "node:path";
import { vi } from "vitest";
import type { SubmitReview } from "../src/agent/tools";
import { db } from "../src/db";
import { approvals, expenses, runs, runSteps } from "../src/db/schema";
import { seed } from "../src/db/seed";
import { setAnthropic } from "../src/lib/llm";
import type { Receipt } from "../src/lib/receipt";
import { runUntilIdle } from "../src/jobs/worker";
import { submitExpense } from "../src/runs/process";
import { receipt } from "./fixtures";

export const RECEIPT_FILE = join(process.cwd(), "data", "receipts", "n01.png");

export function daysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** A receipt dated recently, so age rules don't depend on when the tests run. */
export const recent = (overrides: Partial<Receipt> = {}) => receipt({ date: daysAgo(3), ...overrides });

type ReviewTurn =
  | { submit: SubmitReview }
  | { tools: { name: string; input: unknown }[] }
  | { text: string }
  | Error;

/**
 * Fake Claude. `extractions` answers receipt extraction (messages.parse) in order; `reviews`
 * scripts the reviewer's turns (messages.create). Every call is recorded for assertions.
 */
export function fakeClaude() {
  const extractions: (Receipt | Error)[] = [];
  const reviews: ReviewTurn[] = [];
  let toolId = 0;
  const usage = { input_tokens: 1000, output_tokens: 100 };

  const parse = vi.fn(async (params: { model: string }) => {
    const next = extractions.shift() ?? recent();
    if (next instanceof Error) throw next;
    return { model: params.model, stop_reason: "end_turn", stop_details: null, usage, parsed_output: next };
  });

  const create = vi.fn(async (params: { model: string }) => {
    const turn = reviews.shift() ?? { submit: { flags: [], summary_for_employee: "Approved.", notes_for_approver: "" } };
    if (turn instanceof Error) throw turn;
    const base = { model: params.model, usage, stop_details: null };
    if ("text" in turn) return { ...base, stop_reason: "end_turn", content: [{ type: "text", text: turn.text }] };
    const calls = "submit" in turn ? [{ name: "submit_review", input: turn.submit }] : turn.tools;
    return {
      ...base,
      stop_reason: "tool_use",
      content: calls.map((c) => ({ type: "tool_use", id: `tool_${++toolId}`, name: c.name, input: c.input })),
    };
  });

  setAnthropic({ beta: { messages: { parse, create } } } as unknown as Anthropic);
  return { extractions, reviews, parse, create };
}

export async function setup() {
  const { companyId, ids } = await seed(db);
  return { companyId, ids, claude: fakeClaude() };
}

/** Submits a receipt and drains the queue. */
export async function submitAndRun(employeeId: string) {
  const { expenseId, runId } = await submitExpense(employeeId, RECEIPT_FILE);
  await runUntilIdle();
  return state(runId, expenseId);
}

export async function state(runId: string, expenseId?: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId ?? run.expenseId));
  const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId)).orderBy(asc(runSteps.seq));
  const chain = await db.select().from(approvals).where(eq(approvals.runId, runId)).orderBy(asc(approvals.seq));
  return { run, expense, steps, chain, runId, expenseId: expense.id };
}
