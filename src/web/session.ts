import { asc, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Actor } from "../auth/permissions";
import { db } from "../db";
import { departments, employees } from "../db/schema";

export const ACTOR_COOKIE = "acting_as";
const DEFAULT_EMAIL = "priya@northwind.test";

export type Viewer = Actor & { name: string; email: string; title: string };

/**
 * Demo sign-in: the "acting as" switcher in the header sets a cookie with an employee id. Every
 * page and action resolves the viewer from it and checks permissions as that person.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const id = (await cookies()).get(ACTOR_COOKIE)?.value;
  const rows = await db.select().from(employees).where(id ? eq(employees.id, id) : eq(employees.email, DEFAULT_EMAIL));
  const e = rows[0] ?? (await db.select().from(employees).where(eq(employees.email, DEFAULT_EMAIL)))[0];
  if (!e) throw new Error("No employees: run `npm run seed`");
  return { id: e.id, companyId: e.companyId, role: e.role, managerId: e.managerId, name: e.name, email: e.email, title: e.title };
});

export const listPeople = cache(async () =>
  db
    .select({ id: employees.id, name: employees.name, title: employees.title, role: employees.role, department: departments.name })
    .from(employees)
    .innerJoin(departments, eq(employees.departmentId, departments.id))
    .orderBy(asc(departments.name), asc(employees.name)),
);
