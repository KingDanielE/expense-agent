import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, sql } from "../src/db";
import { companies, departments, employees, policies } from "../src/db/schema";
import { COMPANY, DEPARTMENTS, EMPLOYEES } from "../src/db/seed-data";

async function main() {
  await sql`TRUNCATE policies, employees, departments, companies CASCADE`;

  const [company] = await db.insert(companies).values(COMPANY).returning();

  const deptRows = await db
    .insert(departments)
    .values(DEPARTMENTS.map((name) => ({ companyId: company.id, name })))
    .returning();
  const deptId = Object.fromEntries(deptRows.map((d) => [d.name, d.id]));

  // Managers first, so reports can point at them.
  const ordered = [...EMPLOYEES].sort((a, b) => Number(a.manager !== null) - Number(b.manager !== null));
  const idByEmail: Record<string, string> = {};
  for (const e of ordered) {
    const [row] = await db
      .insert(employees)
      .values({
        companyId: company.id,
        departmentId: deptId[e.department],
        managerId: e.manager ? idByEmail[e.manager] : null,
        name: e.name,
        email: e.email,
        title: e.title,
        role: e.role,
        salaryCents: e.salary * 100,
      })
      .returning({ id: employees.id });
    idByEmail[e.email] = row.id;
  }

  const body = readFileSync(join(process.cwd(), "policy", "policy.md"), "utf8");
  await db.insert(policies).values({ companyId: company.id, version: 1, body });

  console.log(`Seeded ${company.name}: ${deptRows.length} departments, ${EMPLOYEES.length} employees, policy v1`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
