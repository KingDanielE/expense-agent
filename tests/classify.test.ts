import { describe, expect, it } from "vitest";
import { classify } from "../src/eval/classify";

describe("classify", () => {
  it("calls an approval of something that needed a human a false approval", () => {
    expect(classify({ outcome: "needs_approval", approvers: ["finance"] }, { outcome: "approve", approvers: [] })).toBe("false_approval");
    expect(classify({ outcome: "reject" }, { outcome: "approve", approvers: [] })).toBe("false_approval");
  });

  it("checks that the right people are in the approval chain", () => {
    const want = { outcome: "needs_approval" as const, approvers: ["manager", "finance"] as ("manager" | "finance")[] };
    expect(classify(want, { outcome: "needs_approval", approvers: ["manager", "finance"] })).toBe("correct");
    expect(classify(want, { outcome: "needs_approval", approvers: ["manager"] })).toBe("missing_approver");
    expect(classify(want, { outcome: "needs_approval", approvers: ["manager", "it", "finance"] })).toBe("over_escalation");
  });

  it("separates a missed rule from a wrong block", () => {
    expect(classify({ outcome: "reject" }, { outcome: "needs_approval", approvers: ["manager"] })).toBe("missed_rule");
    expect(classify({ outcome: "approve" }, { outcome: "needs_info", approvers: [] })).toBe("wrong_block");
    expect(classify({ outcome: "reject" }, { outcome: "needs_info", approvers: [] })).toBe("wrong_block");
    expect(classify({ outcome: "approve" }, { outcome: "needs_approval", approvers: ["manager"] })).toBe("over_escalation");
  });

  it("reports a crashed case as an error", () => {
    expect(classify({ outcome: "approve" }, null)).toBe("error");
  });
});
