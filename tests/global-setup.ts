import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Creates the test database if needed and brings it to the latest migration.
export default async function setup() {
  const url = new URL("postgres://expense:expense@127.0.0.1:5434/expense_agent_test");
  const admin = postgres({ ...parse(url), database: "postgres", max: 1, onnotice: () => {} });
  const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = 'expense_agent_test'`;
  if (!exists) await admin.unsafe("CREATE DATABASE expense_agent_test");
  await admin.end();

  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();
}

function parse(url: URL) {
  return { host: url.hostname, port: Number(url.port), username: url.username, password: url.password };
}
