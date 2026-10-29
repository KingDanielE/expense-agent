import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { jobs } from "../src/db/schema";
import { claim } from "../src/jobs/queue";
import { runUntilIdle } from "../src/jobs/worker";
import { decideApproval, PermissionDenied } from "../src/runs/process";
import { daysAgo, recent, setup, state, submitAndRun } from "./harness";

let ids: Record<string, string>;
let claude: Awaited<ReturnType<typeof setup>>["claude"];

beforeEach(async () => {
  ({ ids, claude } = await setup());
});

const names = (steps: { type: string; name: string }[]) => steps.map((s) => `${s.type}:${s.name}`);

describe("expense runs", () => {
  it("approves a clean receipt and logs every step in order", async () => {
    const s = await submitAndRun(ids["priya@northwind.test"]);

    expect(s.expense.status).toBe("approved");
    expect(s.expense.reimbursableUsdCents).toBe(2478);
    expect(s.run).toMatchObject({ status: "completed", stage: "done", actingFor: ids["priya@northwind.test"] });
    expect(names(s.steps)).toEqual([
      "status:submitted",
      "extract:extract_receipt",
      "check:fx_rate",
      "check:duplicate_check",
      "check:meals_same_day",
      "policy:policy_engine",
      "model_call:review turn 1",
      "tool_call:submit_review",
      "decision:final_decision",
      "status:completed",
    ]);
    const extract = s.steps[1];
    expect(extract).toMatchObject({ model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 100 });
    expect(extract.costMicroUsd).toBeGreaterThan(0);
  });

  it("parks a flagged claim for the manager and finishes when they approve", async () => {
    claude.reviews.push({
      submit: { flags: [{ approver: "manager", reason: "Lunch for two on a solo day?" }], summary_for_employee: "", notes_for_approver: "" },
    });
    const s = await submitAndRun(ids["priya@northwind.test"]);
    expect(s.expense.status).toBe("waiting_approval");
    expect(s.run.status).toBe("waiting_approval");
    expect(s.chain).toMatchObject([{ seq: 1, approverId: ids["jordan@northwind.test"], status: "pending" }]);

    await decideApproval(s.chain[0].id, ids["jordan@northwind.test"], "approved", "fine");
    await runUntilIdle();
    const after = await state(s.runId);
    expect(after.expense.status).toBe("approved");
    expect(after.run.status).toBe("completed");
  });

  it("refuses approvals from the wrong people and logs every attempt", async () => {
    claude.reviews.push({ submit: { flags: [{ approver: "manager", reason: "x" }], summary_for_employee: "", notes_for_approver: "" } });
    const s = await submitAndRun(ids["priya@northwind.test"]);
    const approval = s.chain[0].id;

    await expect(decideApproval(approval, ids["priya@northwind.test"], "approved")).rejects.toThrow("nobody approves their own expense");
    await expect(decideApproval(approval, ids["alex@northwind.test"], "approved")).rejects.toBeInstanceOf(PermissionDenied);
    await expect(decideApproval(approval, ids["maya@northwind.test"], "approved")).rejects.toThrow("someone else is the named approver");

    const after = await state(s.runId);
    expect(after.chain[0].status).toBe("pending");
    const attempts = after.steps.filter((x) => x.type === "approval_decision");
    expect(attempts.map((a) => a.permission)).toEqual(["denied", "denied", "denied"]);
    expect(attempts.map((a) => a.actorId)).toEqual([
      ids["priya@northwind.test"],
      ids["alex@northwind.test"],
      ids["maya@northwind.test"],
    ]);
  });

  it("walks an approval chain in order: manager, IT, then Finance", async () => {
    claude.extractions.push(
      recent({ category: "equipment", subtotal: 1500, tax: 0, tip: 0, total: 1500, line_items: [], merchant: "Circuit Depot" }),
    );
    claude.reviews.push({ submit: { flags: [{ approver: "manager", reason: "Laptop already issued?" }], summary_for_employee: "", notes_for_approver: "" } });
    const s = await submitAndRun(ids["sam@northwind.test"]);
    expect(s.chain.map((a) => [a.approverId ?? a.approverRole, a.status])).toEqual([
      [ids["jordan@northwind.test"], "pending"],
      ["it", "waiting"],
      ["finance", "waiting"],
    ]);

    // Finance can't jump the queue.
    await expect(decideApproval(s.chain[2].id, ids["maya@northwind.test"], "approved")).rejects.toThrow("waiting, not pending");

    await decideApproval(s.chain[0].id, ids["jordan@northwind.test"], "approved");
    await runUntilIdle();
    await decideApproval(s.chain[1].id, ids["morgan@northwind.test"], "approved");
    await runUntilIdle();
    expect((await state(s.runId)).expense.status).toBe("waiting_approval");

    await decideApproval(s.chain[2].id, ids["jamie@northwind.test"], "approved");
    await runUntilIdle();
    const done = await state(s.runId);
    expect(done.expense.status).toBe("approved");
    expect(done.chain.map((a) => a.status)).toEqual(["approved", "approved", "approved"]);
  });

  it("stops the chain at the first rejection", async () => {
    claude.reviews.push({ submit: { flags: [{ approver: "manager", reason: "x" }], summary_for_employee: "", notes_for_approver: "" } });
    const s = await submitAndRun(ids["taylor@northwind.test"]);
    await decideApproval(s.chain[0].id, ids["alex@northwind.test"], "rejected", "personal lunch");
    await runUntilIdle();
    const after = await state(s.runId);
    expect(after.expense.status).toBe("rejected");
    expect(after.run.status).toBe("completed");
  });

  it("rejects the same receipt submitted twice, even by someone else", async () => {
    const first = await submitAndRun(ids["priya@northwind.test"]);
    expect(first.expense.status).toBe("approved");
    const second = await submitAndRun(ids["sam@northwind.test"]);
    expect(second.expense.status).toBe("rejected");
    const dup = second.steps.find((x) => x.name === "duplicate_check")!;
    expect(dup.output).toEqual({ duplicate_of: first.expenseId }); // an id, nothing about whose
    expect(claude.create).toHaveBeenCalledTimes(1); // no LLM review for a rule-based rejection
  });

  it("applies the daily meal limit across separate receipts", async () => {
    const day = daysAgo(2);
    claude.extractions.push(
      recent({ date: day, merchant: "Green Bowl", subtotal: 50, tax: 0, tip: 0, total: 50, line_items: [] }),
      recent({ date: day, merchant: "Sunrise Bagels", subtotal: 40, tax: 0, tip: 0, total: 40, line_items: [] }),
    );
    await submitAndRun(ids["riley@northwind.test"]);
    const second = await submitAndRun(ids["riley@northwind.test"]);
    expect(second.expense.reimbursableUsdCents).toBe(2500); // $75 - $50 already claimed
    expect(second.steps.find((x) => x.name === "meals_same_day")!.output).toEqual({ usd_cents: 5000 });
  });

  it("asks for a clearer copy when extraction fails, without calling the reviewer", async () => {
    claude.extractions.push(recent({ currency: "dollars" }), recent({ currency: "dollars" }));
    const s = await submitAndRun(ids["priya@northwind.test"]);
    expect(s.expense.status).toBe("needs_info");
    expect(claude.create).not.toHaveBeenCalled();
  });
});

describe("the AI reviewer", () => {
  it("acts with the employee's permissions: salary lookups are denied and logged", async () => {
    claude.reviews.push(
      { tools: [{ name: "get_compensation", input: { email: "jordan@northwind.test" } }, { name: "list_expenses", input: { email: "priya@northwind.test", limit: 5 } }] },
      { submit: { flags: [], summary_for_employee: "Approved.", notes_for_approver: "" } },
    );
    const s = await submitAndRun(ids["priya@northwind.test"]);

    const tools = s.steps.filter((x) => x.type === "tool_call" && x.name !== "submit_review");
    expect(tools.map((t) => [t.name, t.permission, t.actorId])).toEqual([
      ["get_compensation", "denied", ids["priya@northwind.test"]],
      ["list_expenses", "allowed", ids["priya@northwind.test"]],
    ]);
    expect(JSON.stringify(tools[0].output)).not.toContain("280000");

    // What went back to the model: an error for the salary, data for the expense list.
    const second = claude.create.mock.calls[1][0] as unknown as { messages: { role: string; content: unknown }[] };
    const results = second.messages.find(
      (m) => m.role === "user" && Array.isArray(m.content) && m.content[0]?.type === "tool_result",
    )!.content as { is_error: boolean; content: string }[];
    expect(results[0]).toMatchObject({ is_error: true });
    expect(results[0].content).toContain("permission denied");
    expect(results[1].is_error).toBe(false);
  });

  it("can't see a colleague's expenses unless it's their manager", async () => {
    claude.reviews.push(
      { tools: [{ name: "list_expenses", input: { email: "sam@northwind.test", limit: 5 } }] },
      { submit: { flags: [], summary_for_employee: "", notes_for_approver: "" } },
    );
    const s = await submitAndRun(ids["priya@northwind.test"]);
    expect(s.steps.find((x) => x.name === "list_expenses")!.permission).toBe("denied");
  });

  it("fails closed: if the reviewer never submits, a person checks the claim", async () => {
    claude.reviews.push({ text: "Looks fine to me." }, { text: "Still fine." });
    const s = await submitAndRun(ids["priya@northwind.test"]);
    expect(s.expense.status).toBe("waiting_approval");
    expect(s.chain[0].reason).toContain("automated review didn't finish");
    expect(claude.create).toHaveBeenCalledTimes(2); // one nudge, then give up
  });
});

describe("durability", () => {
  it("retries after a crash and resumes from the last committed stage", async () => {
    claude.reviews.push(new Error("connection reset"));
    const s = await submitAndRun(ids["priya@northwind.test"]);
    expect(s.run.stage).toBe("review"); // extraction and policy are committed
    const [job] = await db.select().from(jobs).where(eq(jobs.kind, "process_run"));
    expect(job).toMatchObject({ status: "queued", attempts: 1 });
    expect(job.lastError).toContain("connection reset");

    await db.update(jobs).set({ runAt: sql`now()` }); // skip the backoff
    await runUntilIdle();
    const after = await state(s.runId);
    expect(after.expense.status).toBe("approved");
    expect(claude.parse).toHaveBeenCalledTimes(1); // the receipt was not extracted twice
  });

  it("picks up a job whose worker died mid-run", async () => {
    const { submitExpense } = await import("../src/runs/process");
    const { RECEIPT_FILE } = await import("./harness");
    await submitExpense(ids["priya@northwind.test"], RECEIPT_FILE);
    const first = await claim(); // a worker claims it... and dies
    expect(first).not.toBeNull();
    expect(await claim()).toBeNull(); // locked: nobody else takes it

    await db.update(jobs).set({ lockedAt: sql`now() - interval '10 minutes'` });
    const again = await claim();
    expect(again?.id).toBe(first!.id);
    expect(again?.attempts).toBe(2);
  });

  it("marks the run failed when the job runs out of attempts", async () => {
    for (let i = 0; i < 5; i++) claude.reviews.push(new Error("overloaded"));
    const s = await submitAndRun(ids["priya@northwind.test"]);
    for (let i = 0; i < 4; i++) {
      await db.update(jobs).set({ runAt: sql`now()` });
      await runUntilIdle();
    }
    const after = await state(s.runId);
    expect(after.run.status).toBe("failed");
    expect(after.steps.at(-1)).toMatchObject({ type: "status", name: "failed" });
  });
});
