import "dotenv/config";
import { db, sql } from "../src/db";
import { seed } from "../src/db/seed";

seed(db)
  .then(({ ids }) => console.log(`Seeded Northwind Labs: ${Object.keys(ids).length} employees, policy v1`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
