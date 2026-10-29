"use server";

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { after } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runUntilIdle } from "@/jobs/worker";
import { decideApproval, PermissionDenied, submitExpense } from "@/runs/process";
import { DEMO, demoAllowance, visitorId } from "@/web/demo";
import { ACTOR_COOKIE, getViewer } from "@/web/session";

const UPLOAD_TYPES = new Set([".png", ".jpg", ".jpeg", ".webp", ".pdf"]);

function safeBack(value: FormDataEntryValue | null) {
  const back = typeof value === "string" ? value : "/";
  return back.startsWith("/") && !back.startsWith("//") ? back : "/";
}

const fail = (message: string): never => redirect(`/?error=${encodeURIComponent(message)}`);

export async function actAs(formData: FormData) {
  const id = String(formData.get("employeeId") ?? "");
  (await cookies()).set(ACTOR_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  redirect(safeBack(formData.get("back")));
}

/**
 * Starts processing once the response is sent. With a separate or embedded worker this is just
 * a head start; on serverless hosting (no long-running worker) it is how runs get processed.
 */
function processSoon() {
  after(() => runUntilIdle().catch((err) => console.error(err)));
}

export async function submitUpload(formData: FormData) {
  if (DEMO) fail("Uploads are off in the public demo. Try one of the test receipts.");
  const viewer = await getViewer();
  const file = formData.get("receipt");
  if (!(file instanceof File) || file.size === 0) fail("Choose a receipt to upload");
  const upload = file as File;
  const ext = extname(upload.name).toLowerCase();
  if (!UPLOAD_TYPES.has(ext)) fail("Receipts must be PNG, JPEG, WebP or PDF");

  const dir = join(process.cwd(), "uploads");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}${ext}`);
  writeFileSync(path, Buffer.from(await upload.arrayBuffer()));

  const { expenseId } = await submitExpense(viewer.id, path);
  processSoon();
  redirect(`/expenses/${expenseId}`);
}

export async function submitSample(formData: FormData) {
  const viewer = await getViewer();
  const id = String(formData.get("sample") ?? "");
  const path = `data/receipts/${id}.png`; // stored relative, so it resolves on any host
  if (!/^[nh]\d\d$/.test(id) || !existsSync(join(process.cwd(), path))) fail("Unknown sample receipt");

  const allowance = await demoAllowance();
  if (!allowance.allowed) fail(allowance.reason);

  const { expenseId } = await submitExpense(viewer.id, path, { visitor: DEMO ? await visitorId() : undefined });
  processSoon();
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
