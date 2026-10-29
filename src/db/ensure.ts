import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Creates the database in `url` if it doesn't exist and applies all migrations. */
export async function ensureDatabase(url: string) {
  const u = new URL(url);
  const name = u.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unexpected database name ${name}`);
  const admin = postgres({
    host: u.hostname,
    port: Number(u.port),
    username: u.username,
    password: u.password,
    database: "postgres",
    max: 1,
    onnotice: () => {},
  });
  const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (!exists) await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();

  const client = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();
}
