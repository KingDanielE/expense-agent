import "dotenv/config";
import { sql } from "../src/db";
import { printRun } from "./cli";

// npm run show -- <run or expense id>
printRun(process.argv[2] ?? "")
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
