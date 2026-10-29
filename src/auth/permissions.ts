import type { Role } from "../db/schema";

/**
 * Who may do what. Every agent tool and every human action goes through `can`, and every check
 * the agent makes is written to the run log with its result, allowed or denied.
 *
 * The agent never has permissions of its own: it acts *for* a person and gets exactly theirs.
 */

export type Actor = { id: string; companyId: string; role: Role; managerId: string | null };

export type Subject = { id: string; companyId: string; managerId: string | null };

export type Check =
  | { action: "employee.read"; employee: Subject }
  | { action: "employee.read_compensation"; employee: Subject }
  | { action: "expense.list"; owner: Subject }
  | {
      action: "expense.read";
      owner: Subject;
      approvals: { approverId: string | null; approverRole: Role | null; status: string }[];
    }
  | {
      action: "expense.decide";
      owner: Subject;
      approval: { approverId: string | null; approverRole: Role | null; status: string };
    };

export type Verdict = { allowed: boolean; reason: string };

const allow = (reason: string): Verdict => ({ allowed: true, reason });
const deny = (reason: string): Verdict => ({ allowed: false, reason });

export function can(actor: Actor, check: Check): Verdict {
  const subject = "employee" in check ? check.employee : check.owner;
  if (subject.companyId !== actor.companyId) return deny("different company");
  const self = subject.id === actor.id;
  const manages = subject.managerId === actor.id;

  switch (check.action) {
    case "employee.read":
      return allow("directory fields are visible to everyone in the company");
    case "employee.read_compensation":
      if (self) return allow("own compensation");
      if (actor.role === "people_ops") return allow("People Ops");
      return deny("compensation is visible only to the employee and People Ops");
    case "expense.list":
      if (self) return allow("own expenses");
      if (manages) return allow("direct report's expenses");
      if (actor.role === "finance") return allow("Finance");
      return deny("expenses are visible only to the employee, their manager and Finance");
    case "expense.read": {
      if (self) return allow("own expense");
      if (manages) return allow("direct report's expense");
      if (actor.role === "finance") return allow("Finance");
      // Approvers in the chain (named, or by role) can see the claim they're asked to decide.
      const onChain = check.approvals.some(
        (a) => a.status !== "waiting" && (a.approverId === actor.id || (!a.approverId && a.approverRole === actor.role)),
      );
      if (onChain) return allow("approver on this expense");
      return deny("expenses are visible only to the employee, their manager, Finance and its approvers");
    }
    case "expense.decide": {
      const a = check.approval;
      if (self) return deny("nobody approves their own expense");
      if (a.status !== "pending") return deny(`this approval is ${a.status}, not pending`);
      if (a.approverId) {
        return a.approverId === actor.id ? allow("named approver") : deny("someone else is the named approver");
      }
      if (a.approverRole && actor.role === a.approverRole) return allow(`${a.approverRole} team`);
      return deny(`only the ${a.approverRole} team can approve this step`);
    }
  }
}
