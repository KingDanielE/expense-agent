import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { parseArgs } from "node:util";
import { db, sql } from "../src/db";
import { approvals } from "../src/db/schema";
import { runUntilIdle } from "../src/jobs/worker";
import { decideApproval } from "../src/runs/process";
import { employeeByEmail, findRun, printRun } from "./cli";

// npm run approve -- --as jordan@northwind.test <expense or run id> approve|reject ["comment"]
const { values, positionals } = parseArgs({ allowPositionals: true, options: { as: { type: "string" } } });

async function main() {
  const [id, verb, comment = ""] = positionals;
  if (!values.as || !id || !["approve", "reject"].includes(verb)) {
    throw new Error('usage: npm run approve -- --as <email> <expense or run id> approve|reject ["comment"]');
  }
  const actor = await employeeByEmail(values.as);
  const run = await findRun(id);
  const [pending] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.runId, run.id), eq(approvals.status, "pending")));
  if (!pending) throw new Error("nothing is waiting for approval on this expense");

  await decideApproval(pending.id, actor.id, verb === "approve" ? "approved" : "rejected", comment);
  await runUntilIdle();
  await printRun(run.id);
}

main()
  .catch(async (err) => {
    console.error(`${err.name}: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
