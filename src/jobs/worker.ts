import { logStep } from "../runs/log";
import { failRun, processRun, resumeRun } from "../runs/process";
import { claim, complete, fail, type Job } from "./queue";

type Handler = { run: (payload: Record<string, unknown>) => Promise<void>; onDead?: (payload: Record<string, unknown>, error: string) => Promise<void> };

const HANDLERS: Record<string, Handler> = {
  process_run: {
    run: (p) => processRun(p.runId as string),
    onDead: (p, error) => failRun(p.runId as string, error),
  },
  resume_run: {
    run: (p) => resumeRun(p.runId as string),
    onDead: (p, error) => failRun(p.runId as string, error),
  },
};

async function handle(job: Job) {
  const handler = HANDLERS[job.kind];
  const payload = job.payload as Record<string, unknown>;
  try {
    if (!handler) throw new Error(`no handler for job kind ${job.kind}`);
    await handler.run(payload);
    await complete(job);
  } catch (err) {
    const result = await fail(job, err);
    console.error(JSON.stringify({ job: job.id, kind: job.kind, attempt: job.attempts, result, error: String(err) }));
    // Failures belong in the audit trail too, not just in server logs.
    if (typeof payload.runId === "string" && result === "retry") {
      await logStep(payload.runId, {
        type: "status",
        name: "retrying",
        output: { attempt: job.attempts, of: job.maxAttempts, error: String(err).slice(0, 500) },
      }).catch(() => {});
    }
    if (result === "dead") await handler?.onDead?.(payload, String(err));
  }
}

/** Runs one job if one is due. Returns false when the queue is empty. */
export async function workOnce(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  await handle(job);
  return true;
}

/** Drains everything that is due right now. Used by tests and the demo scripts. */
export async function runUntilIdle(max = 100): Promise<number> {
  let n = 0;
  while (n < max && (await workOnce())) n++;
  return n;
}

export async function startWorker(signal: AbortSignal, idleMs = 1000) {
  while (!signal.aborted) {
    const worked = await workOnce().catch((err) => {
      console.error(err);
      return false;
    });
    if (!worked) await new Promise((r) => setTimeout(r, idleMs));
  }
}
