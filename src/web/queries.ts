import { asc, desc, eq } from "drizzle-orm";
import { can } from "../auth/permissions";
import { db } from "../db";
import { approvals, employees, expenses, runs, runSteps } from "../db/schema";
import type { Viewer } from "./session";

export type ExpenseRow = typeof expenses.$inferSelect;

export async function listMyExpenses(viewer: Viewer) {
  return db.select().from(expenses).where(eq(expenses.employeeId, viewer.id)).orderBy(desc(expenses.submittedAt));
}

/** Pending approval steps this viewer is allowed to decide. */
export async function listInbox(viewer: Viewer) {
  const rows = await db
    .select({ approval: approvals, expense: expenses, owner: employees })
    .from(approvals)
    .innerJoin(expenses, eq(approvals.expenseId, expenses.id))
    .innerJoin(employees, eq(expenses.employeeId, employees.id))
    .where(eq(approvals.status, "pending"))
    .orderBy(asc(approvals.createdAt));
  return rows.filter(
    (r) =>
      can(viewer, {
        action: "expense.decide",
        owner: { id: r.owner.id, companyId: r.owner.companyId, managerId: r.owner.managerId },
        approval: r.approval,
      }).allowed,
  );
}

export async function getExpenseView(id: string, viewer: Viewer) {
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (!expense) return null;
  const [owner] = await db.select().from(employees).where(eq(employees.id, expense.employeeId));
  const chain = await db.select().from(approvals).where(eq(approvals.expenseId, id)).orderBy(asc(approvals.seq));

  const verdict = can(viewer, {
    action: "expense.read",
    owner: { id: owner.id, companyId: owner.companyId, managerId: owner.managerId },
    approvals: chain,
  });
  if (!verdict.allowed) return { denied: verdict.reason } as const;

  const [run] = await db.select().from(runs).where(eq(runs.expenseId, id));
  const steps = run ? await db.select().from(runSteps).where(eq(runSteps.runId, run.id)).orderBy(asc(runSteps.seq)) : [];
  const people = Object.fromEntries(
    (await db.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.companyId, owner.companyId))).map(
      (p) => [p.id, p.name],
    ),
  );
  return { expense, owner, chain, run, steps, people, decidable: chain.find((a) => a.status === "pending") ?? null };
}
