import { ensureDatabase } from "../src/db/ensure";

// Creates the test database if needed and brings it to the latest migration.
export default async function setup() {
  await ensureDatabase("postgres://expense:expense@127.0.0.1:5434/expense_agent_test");
}
