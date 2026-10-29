import { desc } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";

// Queue status for the operator (DEBUG_TOKEN as a bearer token): recent jobs, no payloads.
export async function GET(req: Request) {
  const token = process.env.DEBUG_TOKEN;
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const rows = await db
    .select({
      kind: jobs.kind,
      status: jobs.status,
      attempts: jobs.attempts,
      runAt: jobs.runAt,
      lockedAt: jobs.lockedAt,
      lastError: jobs.lastError,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .limit(20);
  return Response.json({ now: new Date().toISOString(), jobs: rows });
}
