import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, employees, policies } from "@/db/schema";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const people = await db
    .select({
      name: employees.name,
      email: employees.email,
      title: employees.title,
      role: employees.role,
      department: departments.name,
    })
    .from(employees)
    .innerJoin(departments, eq(employees.departmentId, departments.id))
    .orderBy(asc(departments.name), asc(employees.name));
  const [policy] = await db.select({ version: policies.version }).from(policies).limit(1);

  return (
    <main className={styles.main}>
      <h1>Expense Agent</h1>
      <p className={styles.lead}>
        Receipts in, policy-checked decisions out. Company, people and policy v
        {policy?.version ?? "?"} are seeded.
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Title</th>
            <th>Department</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.email}>
              <td>{p.name}</td>
              <td>{p.title}</td>
              <td>{p.department}</td>
              <td>
                <code>{p.role}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
