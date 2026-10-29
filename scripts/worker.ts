import "dotenv/config";
import { sql } from "../src/db";
import { startWorker } from "../src/jobs/worker";

// npm run worker: processes queued runs until Ctrl+C.
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());

console.log("worker started");
startWorker(controller.signal).finally(() => sql.end());
