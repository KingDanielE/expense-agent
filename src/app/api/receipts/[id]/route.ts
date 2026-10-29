import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { getExpenseView } from "@/web/queries";
import { getViewer } from "@/web/session";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

// Receipt images are served only to people who may read the expense.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getExpenseView(id, await getViewer());
  if (!view) return new Response("Not found", { status: 404 });
  if ("denied" in view) return new Response("Forbidden", { status: 403 });
  const path = view.expense.filePath;
  return new Response(new Uint8Array(await readFile(path)), {
    headers: { "content-type": TYPES[extname(path).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" }, // per-viewer: a cached copy would outlive a switch of user
  });
}
