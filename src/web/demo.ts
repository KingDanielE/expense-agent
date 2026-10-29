import { createHash } from "node:crypto";
import { and, count, eq, gte } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "../db";
import { expenses } from "../db/schema";

/**
 * Public demo guardrails (DEMO_MODE=1): test receipts only, a daily cap on claims across all
 * visitors and an hourly cap per visitor, so a public link can't run up the model bill.
 */
export const DEMO = process.env.DEMO_MODE === "1";
const DAILY = Number(process.env.DEMO_DAILY_CLAIMS ?? 150);
const HOURLY_PER_VISITOR = Number(process.env.DEMO_HOURLY_CLAIMS_PER_VISITOR ?? 10);

/** A salted hash of the caller's IP: enough to count their claims, useless for anything else. */
export async function visitorId(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
  return createHash("sha256")
    .update(`${process.env.VISITOR_SALT ?? "expense-agent"}:${ip}`)
    .digest("hex")
    .slice(0, 24);
}

async function claimsSince(since: Date, visitor?: string) {
  const [row] = await db
    .select({ n: count() })
    .from(expenses)
    .where(visitor ? and(gte(expenses.submittedAt, since), eq(expenses.visitor, visitor)) : gte(expenses.submittedAt, since));
  return row.n;
}

export async function demoAllowance() {
  if (!DEMO) return { allowed: true, leftToday: null as number | null, reason: "" };
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const usedToday = await claimsSince(today);
  if (usedToday >= DAILY) return { allowed: false, leftToday: 0, reason: "The demo has reached today's limit of claims. It resets at midnight UTC." };
  const visitor = await visitorId();
  const usedHour = await claimsSince(new Date(Date.now() - 3_600_000), visitor);
  if (usedHour >= HOURLY_PER_VISITOR) {
    return { allowed: false, leftToday: DAILY - usedToday, reason: `You've submitted ${HOURLY_PER_VISITOR} claims in the last hour. Try again a little later.` };
  }
  return { allowed: true, leftToday: DAILY - usedToday, reason: "" };
}
