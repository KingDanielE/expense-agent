import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql as rawSql } from "drizzle-orm";
import type { db as Db } from ".";
import { companies, departments, employees, policies } from "./schema";
import { COMPANY, DEPARTMENTS, EMPLOYEES } from "./seed-data";

export const ALL_TABLES = "jobs, run_steps, approvals, runs, expenses, policies, employees, departments, companies";

/** Wipes everything and seeds Northwind Labs. Returns the company id and employee ids by email. */
export async function seed(db: typeof Db) {
  await db.execute(rawSql.raw(`TRUNCATE ${ALL_TABLES} CASCADE`));

  const [company] = await db.insert(companies).values(COMPANY).returning();
  const deptRows = await db
    .insert(departments)
    .values(DEPARTMENTS.map((name) => ({ companyId: company.id, name })))
    .returning();
  const deptId = Object.fromEntries(deptRows.map((d) => [d.name, d.id]));

  // Managers first, so reports can point at them.
  const ordered = [...EMPLOYEES].sort((a, b) => Number(a.manager !== null) - Number(b.manager !== null));
  const ids: Record<string, string> = {};
  for (const e of ordered) {
    const [row] = await db
      .insert(employees)
      .values({
        companyId: company.id,
        departmentId: deptId[e.department],
        managerId: e.manager ? ids[e.manager] : null,
        name: e.name,
        email: e.email,
        title: e.title,
        role: e.role,
        salaryCents: e.salary * 100,
      })
      .returning({ id: employees.id });
    ids[e.email] = row.id;
  }

  const body = readFileSync(join(process.cwd(), "policy", "policy.md"), "utf8");
  await db.insert(policies).values({ companyId: company.id, version: 1, body });
  return { companyId: company.id, ids };
}
