import { workOnce } from "@/jobs/worker";
import { getExpenseView } from "@/web/queries";
import { getViewer } from "@/web/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // a whole run fits: two model calls, each capped at 45s

/**
 * Polled by the expense page while a run is in progress (one request at a time). Serverless has
 * no worker, and work started after a response is sent gets frozen part-way, so this request
 * does the work itself: it processes a queued (or stalled) run before answering. The queue's
 * locks make concurrent polls return straight away instead of doing the work twice.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  let view = await getExpenseView(id, viewer);
  if (!view) return new Response("Not found", { status: 404 });
  if ("denied" in view) return new Response("Forbidden", { status: 403 });

  const run = view.run;
  if (run && (run.status === "queued" || (run.status === "running" && Date.now() - run.updatedAt.getTime() > 20_000))) {
    await workOnce(`run:${run.id}`).catch((err) => console.error(err));
    view = await getExpenseView(id, viewer);
    if (!view || "denied" in view) return new Response("Gone", { status: 410 });
  }
  return Response.json(
    { status: view.expense.status, run: view.run?.status ?? null, steps: view.steps.length },
    { headers: { "cache-control": "no-store" } },
  );
}
