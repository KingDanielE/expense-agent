import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type Actor, can, type Check } from "../auth/permissions";
import { db } from "../db";
import { departments, employees, expenses, policies } from "../db/schema";
import { logStep } from "../runs/log";

/**
 * The reviewer's tools. Each one runs with the permissions of the person the agent is acting
 * for (`ctx.actor`), checks them before anything is returned, and logs the call, its input, its result
 * and the permission verdict to the run log. A denied call returns an error to the model; it
 * never sees the data.
 */

export type ToolContext = { runId: string; actor: Actor };
export type ToolResult = { content: string; isError: boolean };

const strict = (properties: Record<string, unknown>) => ({
  type: "object" as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const Email = z.object({ email: z.string() });
const ListExpenses = z.object({ email: z.string(), limit: z.number().int() });
export const SubmitReview = z.object({
  flags: z.array(z.object({ approver: z.enum(["manager", "finance"]), reason: z.string() })),
  summary_for_employee: z.string(),
  notes_for_approver: z.string(),
});
export type SubmitReview = z.infer<typeof SubmitReview>;

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_employee",
    description: "Look up a colleague's directory entry: name, title, department, role and manager.",
    input_schema: strict({ email: { type: "string" } }),
    strict: true,
  },
  {
    name: "get_compensation",
    description: "Look up an employee's salary. Only the employee themself and People Ops may see it.",
    input_schema: strict({ email: { type: "string" } }),
    strict: true,
  },
  {
    name: "get_policy",
    description: "Read the full company expense policy.",
    input_schema: strict({}),
    strict: true,
  },
  {
    name: "list_expenses",
    description:
      "List an employee's most recent expenses (date, merchant, category, amount, status). Visible to the employee, their manager and Finance.",
    input_schema: strict({ email: { type: "string" }, limit: { type: "integer", description: "1 to 20" } }),
    strict: true,
  },
  {
    name: "submit_review",
    description:
      "Finish the review. Call exactly once. `flags` asks for human approval (empty if nothing needs a human beyond what the rules already require).",
    input_schema: strict({
      flags: {
        type: "array",
        items: strict({
          approver: { type: "string", enum: ["manager", "finance"] },
          reason: { type: "string", description: "One sentence an approver can act on." },
        }),
      },
      summary_for_employee: { type: "string", description: "Two or three plain sentences about the outcome." },
      notes_for_approver: { type: "string", description: "Anything an approver should know; empty if nothing." },
    }),
    strict: true,
  },
];

async function findEmployee(companyId: string, email: string) {
  const [row] = await db
    .select({
      id: employees.id,
      companyId: employees.companyId,
      managerId: employees.managerId,
      name: employees.name,
      email: employees.email,
      title: employees.title,
      role: employees.role,
      department: departments.name,
      salaryCents: employees.salaryCents,
    })
    .from(employees)
    .innerJoin(departments, eq(employees.departmentId, departments.id))
    .where(and(eq(employees.companyId, companyId), eq(employees.email, email.toLowerCase().trim())));
  return row;
}

type Outcome = { result: unknown; check?: Check };

async function execute(ctx: ToolContext, name: string, input: unknown): Promise<Outcome> {
  const { companyId } = ctx.actor;
  switch (name) {
    case "get_employee": {
      const { email } = Email.parse(input);
      const e = await findEmployee(companyId, email);
      if (!e) return { result: { error: `no employee with email ${email}` } };
      const manager = e.managerId
        ? (await db.select({ name: employees.name, email: employees.email }).from(employees).where(eq(employees.id, e.managerId)))[0]
        : null;
      return {
        check: { action: "employee.read", employee: e },
        result: { name: e.name, email: e.email, title: e.title, department: e.department, role: e.role, manager },
      };
    }
    case "get_compensation": {
      const { email } = Email.parse(input);
      const e = await findEmployee(companyId, email);
      if (!e) return { result: { error: `no employee with email ${email}` } };
      return {
        check: { action: "employee.read_compensation", employee: e },
        result: { name: e.name, annual_salary_usd: e.salaryCents / 100 },
      };
    }
    case "get_policy": {
      const [p] = await db
        .select({ version: policies.version, body: policies.body })
        .from(policies)
        .where(eq(policies.companyId, companyId))
        .orderBy(desc(policies.version))
        .limit(1);
      return { result: p ?? { error: "no policy" } };
    }
    case "list_expenses": {
      const { email, limit } = ListExpenses.parse(input);
      const e = await findEmployee(companyId, email);
      if (!e) return { result: { error: `no employee with email ${email}` } };
      const rows = await db
        .select({
          date: expenses.expenseDate,
          merchant: expenses.merchant,
          category: expenses.category,
          currency: expenses.currency,
          total_minor: expenses.totalMinor,
          status: expenses.status,
        })
        .from(expenses)
        .where(eq(expenses.employeeId, e.id))
        .orderBy(desc(expenses.submittedAt))
        .limit(Math.min(Math.max(limit, 1), 20));
      return { check: { action: "expense.list", owner: e }, result: rows };
    }
    default:
      return { result: { error: `unknown tool ${name}` } };
  }
}

/** Runs one tool call for the reviewer: permission check, execution, run-log entry. */
export async function callTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolResult> {
  const started = Date.now();
  let outcome: Outcome;
  try {
    outcome = await execute(ctx, name, input);
  } catch (err) {
    const message = err instanceof z.ZodError ? `invalid input: ${err.issues[0]?.message}` : (err as Error).message;
    await logStep(ctx.runId, { type: "tool_call", name, actorId: ctx.actor.id, input, output: { error: message } });
    return { content: JSON.stringify({ error: message }), isError: true };
  }

  const verdict = outcome.check ? can(ctx.actor, outcome.check) : null;
  const denied = verdict && !verdict.allowed;
  const result = denied ? { error: `permission denied: ${verdict.reason}` } : outcome.result;
  await logStep(ctx.runId, {
    type: "tool_call",
    name,
    actorId: ctx.actor.id,
    permission: verdict ? (verdict.allowed ? "allowed" : "denied") : null,
    input,
    output: denied ? { error: verdict.reason } : result,
    latencyMs: Date.now() - started,
  });
  return { content: JSON.stringify(result), isError: !!denied || (typeof result === "object" && result !== null && "error" in result) };
}
