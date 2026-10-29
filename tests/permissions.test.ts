import { describe, expect, it } from "vitest";
import { type Actor, can } from "../src/auth/permissions";

const co = "c1";
const actor = (id: string, role: Actor["role"], managerId: string | null = null): Actor => ({ id, companyId: co, role, managerId });
const priya = { id: "priya", companyId: co, managerId: "jordan" };

describe("expense.read", () => {
  const read = (who: Actor, approvals: { approverId: string | null; approverRole: Actor["role"] | null; status: string }[] = []) =>
    can(who, { action: "expense.read", owner: priya, approvals }).allowed;

  it("lets the employee, their manager and Finance read it", () => {
    expect(read(actor("priya", "employee", "jordan"))).toBe(true);
    expect(read(actor("jordan", "manager"))).toBe(true);
    expect(read(actor("maya", "finance"))).toBe(true);
  });

  it("keeps other managers and colleagues out", () => {
    expect(read(actor("alex", "manager"))).toBe(false);
    expect(read(actor("sam", "employee", "jordan"))).toBe(false);
  });

  it("lets IT read it once it's their turn to approve, not before", () => {
    const morgan = actor("morgan", "it");
    expect(read(morgan, [{ approverId: null, approverRole: "it", status: "waiting" }])).toBe(false);
    expect(read(morgan, [{ approverId: null, approverRole: "it", status: "pending" }])).toBe(true);
    expect(read(morgan, [{ approverId: null, approverRole: "it", status: "approved" }])).toBe(true);
  });

  it("never crosses companies", () => {
    expect(can({ ...actor("x", "finance"), companyId: "other" }, { action: "expense.read", owner: priya, approvals: [] }).allowed).toBe(false);
  });
});
