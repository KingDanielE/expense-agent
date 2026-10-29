import { sql } from "drizzle-orm";
import { db } from "../db";
import { runSteps } from "../db/schema";

export type StepType =
  | "extract" // receipt → structured data (model call)
  | "check" // a fact code looked up itself (duplicates, FX, spend)
  | "policy" // the rules engine's decision
  | "model_call" // one reviewer turn
  | "tool_call" // a tool the reviewer called, with its permission check
  | "decision" // the final decision after reviewer flags
  | "approval_requested"
  | "approval_decision"
  | "status"; // run lifecycle: completed, failed, resumed

export type Step = {
  type: StepType;
  name: string;
  actorId?: string | null;
  permission?: "allowed" | "denied" | null;
  input?: unknown;
  output?: unknown;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number | null;
  latencyMs?: number;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Appends a step to a run's log. Steps are numbered per run, in the order they happened. */
export async function logStep(runId: string, step: Step, tx: Tx | typeof db = db) {
  await tx.insert(runSteps).values({
    runId,
    seq: sql`(SELECT coalesce(max(seq), 0) + 1 FROM run_steps WHERE run_id = ${runId})`,
    type: step.type,
    name: step.name,
    actorId: step.actorId ?? null,
    permission: step.permission ?? null,
    input: step.input ?? null,
    output: step.output ?? null,
    model: step.model ?? null,
    inputTokens: step.inputTokens ?? null,
    outputTokens: step.outputTokens ?? null,
    costMicroUsd: step.costUsd == null ? null : Math.round(step.costUsd * 1_000_000),
    latencyMs: step.latencyMs ?? null,
  });
}

export type { Tx };
