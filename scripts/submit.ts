import "dotenv/config";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { sql } from "../src/db";
import { runUntilIdle } from "../src/jobs/worker";
import { submitExpense } from "../src/runs/process";
import { employeeByEmail, printRun } from "./cli";

// npm run submit -- --as priya@northwind.test data/receipts/h01.png [more files] [--no-wait]
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { as: { type: "string" }, "no-wait": { type: "boolean", default: false } },
});

async function main() {
  if (!values.as || positionals.length === 0) throw new Error("usage: npm run submit -- --as <email> <receipt>...");
  const employee = await employeeByEmail(values.as);
  const submitted = [];
  for (const file of positionals) submitted.push(await submitExpense(employee.id, resolve(file)));
  if (values["no-wait"]) {
    for (const s of submitted) console.log(`queued expense ${s.expenseId} run ${s.runId}`);
    return;
  }
  await runUntilIdle();
  for (const s of submitted) await printRun(s.runId);
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
