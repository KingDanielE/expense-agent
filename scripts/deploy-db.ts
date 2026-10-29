import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Runs during the Vercel build (the only place the sensitive DATABASE_URL is readable):
// applies migrations, then seeds the demo company if the database is empty.
async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.log("deploy-db: no DATABASE_URL, skipping");
    return;
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    console.log("deploy-db: migrations applied");
  } finally {
    await client.end();
  }

  const { db, sql } = await import("../src/db");
  const { companies } = await import("../src/db/schema");
  const { seed } = await import("../src/db/seed");
  try {
    const [{ n }] = await db.select({ n: count() }).from(companies);
    if (n === 0) {
      const { ids } = await seed(db);
      console.log(`deploy-db: seeded ${Object.keys(ids).length} employees`);
    } else {
      console.log("deploy-db: data present, not seeding");
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
