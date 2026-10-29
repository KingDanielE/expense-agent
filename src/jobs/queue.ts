import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { jobs } from "../db/schema";
import type { Tx } from "../runs/log";

/**
 * A Postgres-backed job queue. Enqueue in the same transaction as the data change it belongs to;
 * workers claim with FOR UPDATE SKIP LOCKED, so any number can run. A job whose worker died is
 * picked up again once its lock is older than LOCK_TIMEOUT. Handlers must be idempotent.
 */

// Longer than the longest function run (maxDuration 120s), so a live worker never loses its lock.
export const LOCK_TIMEOUT_SECONDS = 150;
const BACKOFF_SECONDS = 15;
const MAX_BACKOFF_SECONDS = 3600;

export type Job = typeof jobs.$inferSelect;

export async function enqueue(
  tx: Tx | typeof db,
  kind: string,
  payload: Record<string, unknown>,
  opts: { dedupeKey?: string; delaySeconds?: number; maxAttempts?: number } = {},
) {
  await tx
    .insert(jobs)
    .values({
      kind,
      payload,
      dedupeKey: opts.dedupeKey ?? null,
      runAt: sql`now() + make_interval(secs => ${opts.delaySeconds ?? 0})`,
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey });
}

/**
 * Claims the next due job (or one abandoned by a dead worker), or returns null. With
 * `dedupeKey`, claims only that job: a request that just created work can do it first instead
 * of picking up whatever older job is next.
 */
export async function claim(dedupeKey?: string): Promise<Job | null> {
  const only = dedupeKey ? sql`AND dedupe_key = ${dedupeKey}` : sql``;
  const rows = await db.execute<Record<string, unknown>>(sql`
    UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE ((status = 'queued' AND run_at <= now())
         OR (status = 'running' AND locked_at < now() - make_interval(secs => ${LOCK_TIMEOUT_SECONDS})))
         ${only}
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`);
  const id = rows[0]?.id as string | undefined;
  if (!id) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job;
}

export async function complete(job: Job) {
  await db.update(jobs).set({ status: "done", lockedAt: null }).where(eq(jobs.id, job.id));
}

/** Schedules a retry with exponential backoff, or marks the job dead after max attempts. */
export async function fail(job: Job, err: unknown) {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (job.attempts >= job.maxAttempts) {
    await db.update(jobs).set({ status: "dead", lockedAt: null, lastError: message }).where(eq(jobs.id, job.id));
    return "dead" as const;
  }
  const delay = Math.min(BACKOFF_SECONDS * 2 ** (job.attempts - 1), MAX_BACKOFF_SECONDS);
  await db
    .update(jobs)
    .set({
      status: "queued",
      lockedAt: null,
      lastError: message,
      runAt: sql`now() + make_interval(secs => ${delay})`,
    })
    .where(eq(jobs.id, job.id));
  return "retry" as const;
}
