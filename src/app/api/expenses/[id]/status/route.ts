import { after } from "next/server";
import { workOnce } from "@/jobs/worker";
import { getExpenseView } from "@/web/queries";
import { getViewer } from "@/web/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // room for a run picked up in after()

/**
 * Polled by the expense page while a run is in progress: returns a small fingerprint that
 * changes with every new step. On serverless there is no worker, so this is also what starts a
 * queued run, or picks up one whose function was cut short; the queue's locks stop double work.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getExpenseView(id, await getViewer());
  if (!view) return new Response("Not found", { status: 404 });
  if ("denied" in view) return new Response("Forbidden", { status: 403 });

  const { run, steps, expense } = view;
  if (run && (run.status === "queued" || (run.status === "running" && Date.now() - run.updatedAt.getTime() > 20_000))) {
    const runId = run.id;
    after(() => workOnce(`run:${runId}`).catch((err) => console.error(err)));
  }
  return Response.json(
    { status: expense.status, run: run?.status ?? null, steps: steps.length },
    { headers: { "cache-control": "no-store" } },
  );
}
