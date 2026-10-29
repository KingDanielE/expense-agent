import { asc, eq, or } from "drizzle-orm";
import { db } from "../src/db";
import { approvals, employees, expenses, runs, runSteps } from "../src/db/schema";

export async function employeeByEmail(email: string) {
  const [e] = await db.select().from(employees).where(eq(employees.email, email));
  if (!e) throw new Error(`no employee ${email} (try priya@northwind.test)`);
  return e;
}

/** Accepts a run id or an expense id. */
export async function findRun(id: string) {
  const [run] = await db.select().from(runs).where(or(eq(runs.id, id), eq(runs.expenseId, id)));
  if (!run) throw new Error(`no run or expense ${id}`);
  return run;
}

const usd = (c: number | null | undefined) => (c == null ? "-" : `$${(c / 100).toFixed(2)}`);

export async function printRun(id: string) {
  const run = await findRun(id);
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, run.expenseId));
  const people = Object.fromEntries((await db.select().from(employees)).map((e) => [e.id, e.email.split("@")[0]]));
  const steps = await db.select().from(runSteps).where(eq(runSteps.runId, run.id)).orderBy(asc(runSteps.seq));
  const chain = await db.select().from(approvals).where(eq(approvals.runId, run.id)).orderBy(asc(approvals.seq));

  console.log(`\nRun ${run.id}  expense ${expense.id}`);
  console.log(`  ${expense.merchant ?? "?"}  ${expense.expenseDate ?? "?"}  status ${expense.status}  reimbursable ${usd(expense.reimbursableUsdCents)}  (run ${run.status}/${run.stage})`);
  let cost = 0;
  for (const s of steps) {
    cost += (s.costMicroUsd ?? 0) / 1e6;
    const who = s.actorId ? ` as ${people[s.actorId]}` : "";
    const perm = s.permission ? ` [${s.permission.toUpperCase()}]` : "";
    const meta = s.model ? `  ${s.model} ${s.inputTokens}/${s.outputTokens} tok ${s.latencyMs}ms` : "";
    const out = JSON.stringify(s.output ?? {});
    console.log(`  ${String(s.seq).padStart(2)}. ${s.type.padEnd(18)} ${s.name}${who}${perm}${meta}`);
    console.log(`      ${out.length > 160 ? out.slice(0, 157) + "..." : out}`);
  }
  for (const a of chain) {
    const who = a.approverId ? people[a.approverId] : `${a.approverRole} team`;
    console.log(`  approval ${a.seq}: ${who} ${a.status}  ${a.reason}`);
  }
  console.log(`  model cost: $${cost.toFixed(4)}`);
}
