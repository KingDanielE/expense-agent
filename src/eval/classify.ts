import type { Outcome } from "../policy/engine";
import type { ExpectedDecision } from "./receipts/decisions";

export type Approver = "manager" | "it" | "finance";

/**
 * How a decision went wrong, worst first. A false approval pays money nobody checked; a missed
 * rule or approver means a human sees it but not the right one; over-escalation and wrong blocks
 * cost people time and goodwill, not money.
 */
export const VERDICTS = [
  "false_approval",
  "missed_rule",
  "missing_approver",
  "wrong_block",
  "over_escalation",
  "error",
  "correct",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export function classify(expected: ExpectedDecision, actual: { outcome: Outcome; approvers: Approver[] } | null): Verdict {
  if (!actual) return "error";
  const e = expected.outcome;
  const a = actual.outcome;
  const blocked = (o: Outcome) => o === "reject" || o === "needs_info";

  if (a === "approve") return e === "approve" ? "correct" : "false_approval";
  if (a === "needs_approval") {
    if (e === "approve") return "over_escalation";
    if (blocked(e)) return "missed_rule"; // a human will look, but the rule should have stopped it
    const want = new Set(expected.approvers ?? []);
    const got = new Set(actual.approvers);
    if ([...want].some((x) => !got.has(x))) return "missing_approver";
    if ([...got].some((x) => !want.has(x))) return "over_escalation";
    return "correct";
  }
  // a is reject or needs_info
  if (blocked(e)) return e === a ? "correct" : "wrong_block";
  return "wrong_block";
}
