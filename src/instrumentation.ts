// Starts the job worker inside the Next.js server when EMBEDDED_WORKER=1 (dev, single instance).
// In production, run `npm run worker` as its own process instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.EMBEDDED_WORKER !== "1") return;
  const g = globalThis as { __expenseWorker?: AbortController };
  if (g.__expenseWorker) return;
  g.__expenseWorker = new AbortController();
  const { startWorker } = await import("./jobs/worker");
  void startWorker(g.__expenseWorker.signal);
  console.log("embedded worker started");
}
