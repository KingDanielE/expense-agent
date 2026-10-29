"use server";

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runUntilIdle } from "@/jobs/worker";
import { decideApproval, PermissionDenied, submitExpense } from "@/runs/process";
import { ACTOR_COOKIE, getViewer } from "@/web/session";

const UPLOAD_TYPES = new Set([".png", ".jpg", ".jpeg", ".webp", ".pdf"]);

function safeBack(value: FormDataEntryValue | null) {
  const back = typeof value === "string" ? value : "/";
  return back.startsWith("/") && !back.startsWith("//") ? back : "/";
}

export async function actAs(formData: FormData) {
  const id = String(formData.get("employeeId") ?? "");
  (await cookies()).set(ACTOR_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(safeBack(formData.get("back")));
}

// Without a separate worker process, nudge the queue so the run starts right away.
function kick() {
  if (process.env.EMBEDDED_WORKER !== "1") void runUntilIdle().catch((err) => console.error(err));
}

export async function submitUpload(formData: FormData) {
  const viewer = await getViewer();
  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) redirect("/?error=Choose a receipt to upload");
  const ext = extname(file.name).toLowerCase();
  if (!UPLOAD_TYPES.has(ext)) redirect("/?error=Receipts must be PNG, JPEG, WebP or PDF");

  const dir = join(process.cwd(), "uploads");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}${ext}`);
  writeFileSync(path, Buffer.from(await file.arrayBuffer()));

  const { expenseId } = await submitExpense(viewer.id, path);
  kick();
  redirect(`/expenses/${expenseId}`);
}

export async function submitSample(formData: FormData) {
  const viewer = await getViewer();
  const id = String(formData.get("sample") ?? "");
  const path = join(process.cwd(), "data", "receipts", `${id}.png`);
  if (!/^[nh]\d\d$/.test(id) || !existsSync(path)) redirect("/?error=Unknown sample receipt");
  const { expenseId } = await submitExpense(viewer.id, path);
  kick();
  redirect(`/expenses/${expenseId}`);
}

export async function decide(formData: FormData) {
  const viewer = await getViewer();
  const approvalId = String(formData.get("approvalId"));
  const verdict = formData.get("decision") === "approve" ? "approved" : "rejected";
  const back = safeBack(formData.get("back"));
  try {
    await decideApproval(approvalId, viewer.id, verdict, String(formData.get("comment") ?? "").slice(0, 500));
  } catch (err) {
    if (!(err instanceof PermissionDenied)) throw err;
    redirect(`${back}?error=${encodeURIComponent(`Not allowed: ${err.message}`)}`);
  }
  await runUntilIdle(); // resuming a run is quick (no model calls), so show the result right away
  redirect(back);
}
