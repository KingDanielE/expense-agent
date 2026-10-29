import type { Role } from "../db/schema";
import type { Receipt } from "../lib/receipt";
import {
  APPROVAL_OVER_CENTS,
  CAPS_CENTS,
  FINANCE_APPROVAL_OVER_CENTS,
  FLIGHT_APPROVAL_OVER_CENTS,
  FLIGHT_PATTERN,
  MAX_AGE_DAYS,
  MAX_TIP_RATE,
  mealLimitCents,
  RULES,
  type RuleId,
} from "./rules";

/**
 * The policy engine: plain code, no model. Given a validated receipt and facts the caller looked
 * up (FX rate, duplicates, what was already spent that day), it decides the outcome, the
 * reimbursable amount and who has to approve. The LLM reviewer can add approvers on top of this
 * (see `withReviewerFlags`), never remove them.
 */

export type Outcome = "approve" | "needs_approval" | "needs_info" | "reject";
const SEVERITY: Record<Outcome, number> = { approve: 0, needs_approval: 1, needs_info: 2, reject: 3 };

export type Approver = { kind: "employee"; employeeId: string } | { kind: "role"; role: "finance" | "it" };

export type Finding = { rule: RuleId; outcome: Outcome; text: string };
export type Adjustment = { rule: RuleId; text: string; usdCents: number }; // negative: removed
export type ApprovalStep = { approver: Approver; rules: RuleId[]; reason: string };

export type PolicyDecision = {
  outcome: Outcome;
  claimedUsdCents: number | null;
  reimbursableUsdCents: number | null;
  adjustments: Adjustment[];
  approvals: ApprovalStep[];
  findings: Finding[];
};

export type PolicyFacts = {
  receipt: Receipt;
  warnings: string[];
  submitter: { id: string; role: Role; managerId: string | null };
  usdPerUnit: number | null;
  duplicateOf: string | null;
  mealsSpentSameDayUsdCents: number;
  today: string; // YYYY-MM-DD
};

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function evaluate(f: PolicyFacts): PolicyDecision {
  const r = f.receipt;
  const findings: Finding[] = [];
  const adjustments: Adjustment[] = [];
  const pending: { approver: Approver; rule: RuleId; detail?: string }[] = [];
  const find = (rule: RuleId, outcome: Outcome, detail?: string) =>
    findings.push({ rule, outcome, text: detail ? `${RULES[rule]} ${detail}` : RULES[rule] });
  const manager: Approver = f.submitter.managerId
    ? { kind: "employee", employeeId: f.submitter.managerId }
    : { kind: "role", role: "finance" }; // nobody approves their own expense
  const needApproval = (approver: Approver, rule: RuleId, detail?: string) => {
    pending.push({ approver, rule, detail });
    find(rule, "needs_approval", detail);
  };

  // 1. Can we read it at all?
  if (!r.is_receipt) find("NOT_RECEIPT", "needs_info");
  else {
    if (r.total === null || r.confidence.total === "low" || r.date === null || r.confidence.date === "low") {
      find("ILLEGIBLE", "needs_info");
    }
    if (f.usdPerUnit === null) find("UNKNOWN_CURRENCY", "needs_info", r.currency ? `(${r.currency})` : "");
  }
  if (findings.length) return finish(null, null);

  const toCents = (amount: number) => Math.round(amount * f.usdPerUnit! * 100);
  const claimed = toCents(r.total!);

  // 2. Hard rejections.
  if (f.duplicateOf) find("DUPLICATE", "reject");
  const age = daysBetween(r.date!, f.today);
  if (age > MAX_AGE_DAYS) find("TOO_OLD", "reject", `This one is ${age} days old.`);
  if (age < 0) find("FUTURE_DATE", "needs_info");
  if (findings.length) return finish(claimed, null);

  // 3. Amounts that are never reimbursed.
  const subtotal = r.subtotal ?? r.total! - (r.tax ?? 0) - (r.tip ?? 0);
  let tip = r.tip ?? 0;
  if (tip > 0 && subtotal > 0 && tip > subtotal * MAX_TIP_RATE + 0.005) {
    const excess = tip - subtotal * MAX_TIP_RATE;
    tip -= excess;
    adjustments.push({ rule: "TIP_CAP", text: RULES.TIP_CAP, usdCents: -toCents(excess) });
  }
  const alcohol = r.line_items.filter((i) => i.is_alcohol).reduce((s, i) => s + i.amount, 0);
  if (alcohol > 0 && subtotal > 0) {
    const share = Math.min(1, alcohol / subtotal);
    const removed = alcohol + share * ((r.tax ?? 0) + tip);
    adjustments.push({ rule: "ALCOHOL", text: RULES.ALCOHOL, usdCents: -toCents(removed) });
  }
  let reimbursable = claimed + adjustments.reduce((s, a) => s + a.usdCents, 0);

  // 4. Category limits and approval thresholds.
  const cap = (rule: RuleId, limit: number, detail: string) => {
    if (reimbursable > limit) {
      adjustments.push({ rule, text: `${RULES[rule]} ${detail}`, usdCents: limit - reimbursable });
      reimbursable = limit;
    }
  };
  switch (r.category) {
    case "meals": {
      const limit = mealLimitCents(f.submitter.role);
      const left = Math.max(0, limit - f.mealsSpentSameDayUsdCents);
      const spent = f.mealsSpentSameDayUsdCents ? `, ${usd(f.mealsSpentSameDayUsdCents)} already claimed that day` : "";
      cap("MEAL_LIMIT", left, `(${usd(limit)} per day${spent})`);
      break;
    }
    case "lodging":
    case "office_supplies":
      cap("CAP", CAPS_CENTS[r.category]!, `(${usd(CAPS_CENTS[r.category]!)})`);
      break;
    case "travel": {
      const text = [r.merchant ?? "", ...r.line_items.map((i) => i.description)].join(" ");
      if (FLIGHT_PATTERN.test(text) && reimbursable > FLIGHT_APPROVAL_OVER_CENTS) needApproval(manager, "FLIGHT");
      break;
    }
    case "software":
    case "equipment": {
      const over = APPROVAL_OVER_CENTS[r.category]!;
      if (reimbursable > over) {
        const approver: Approver = r.category === "equipment" ? { kind: "role", role: "it" } : manager;
        needApproval(approver, "CATEGORY_APPROVAL", `(${r.category} over ${usd(over)})`);
      }
      break;
    }
    case "other":
      needApproval(manager, "OTHER");
      break;
  }

  if (reimbursable <= 0) {
    find("NOTHING_LEFT", "reject");
    return finish(claimed, 0);
  }

  // 5. Things a human should look at.
  if (reimbursable > FINANCE_APPROVAL_OVER_CENTS) needApproval({ kind: "role", role: "finance" }, "FINANCE");
  if (f.warnings.length) needApproval(manager, "ARITHMETIC", f.warnings.join("; "));
  if (r.instructions_detected) needApproval({ kind: "role", role: "finance" }, "INSTRUCTIONS");

  return finish(claimed, reimbursable);

  function finish(claimedUsdCents: number | null, reimbursableUsdCents: number | null): PolicyDecision {
    const outcome = findings.reduce<Outcome>((o, x) => (SEVERITY[x.outcome] > SEVERITY[o] ? x.outcome : o), "approve");
    return {
      outcome,
      claimedUsdCents,
      reimbursableUsdCents,
      adjustments,
      approvals: outcome === "needs_approval" ? mergeApprovals(pending) : [],
      findings,
    };
  }
}

const approverKey = (a: Approver) => (a.kind === "employee" ? `e:${a.employeeId}` : `r:${a.role}`);

// One step per approver, manager first, then IT, then Finance.
function sortSteps(steps: ApprovalStep[]): ApprovalStep[] {
  const order = (a: Approver) => (a.kind === "employee" ? 0 : a.role === "it" ? 1 : 2);
  return steps.sort((a, b) => order(a.approver) - order(b.approver));
}

function mergeApprovals(pending: { approver: Approver; rule: RuleId; detail?: string }[]): ApprovalStep[] {
  const steps = new Map<string, ApprovalStep>();
  for (const p of pending) {
    const key = approverKey(p.approver);
    const step = steps.get(key) ?? { approver: p.approver, rules: [], reason: "" };
    step.rules.push(p.rule);
    const line = p.detail ? `${RULES[p.rule]} ${p.detail}` : RULES[p.rule];
    step.reason = step.reason ? `${step.reason} ${line}` : line;
    steps.set(key, step);
  }
  return sortSteps([...steps.values()]);
}

export type ReviewerFlag = { approver: "manager" | "finance"; reason: string };

/**
 * Applies the AI reviewer's flags. They can only add human approval to an expense the rules would
 * approve or already send for approval; they can't approve, reject, or change amounts.
 */
export function withReviewerFlags(
  d: PolicyDecision,
  flags: ReviewerFlag[],
  submitter: PolicyFacts["submitter"],
): PolicyDecision {
  if (flags.length === 0 || d.outcome === "reject" || d.outcome === "needs_info") return d;
  const steps = new Map(d.approvals.map((s) => [approverKey(s.approver), { ...s, rules: [...s.rules] }]));
  const findings = [...d.findings];
  for (const flag of flags) {
    const approver: Approver =
      flag.approver === "manager" && submitter.managerId
        ? { kind: "employee", employeeId: submitter.managerId }
        : { kind: "role", role: "finance" };
    const text = `${RULES.REVIEWER_FLAG} ${flag.reason}`;
    findings.push({ rule: "REVIEWER_FLAG", outcome: "needs_approval", text });
    const step = steps.get(approverKey(approver));
    if (step) {
      step.rules.push("REVIEWER_FLAG");
      step.reason = `${step.reason} ${text}`;
    } else {
      steps.set(approverKey(approver), { approver, rules: ["REVIEWER_FLAG"], reason: text });
    }
  }
  return { ...d, outcome: "needs_approval", findings, approvals: sortSteps([...steps.values()]) };
}
