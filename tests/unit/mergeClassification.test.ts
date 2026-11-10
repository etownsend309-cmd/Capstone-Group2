import { describe, expect, it } from "vitest";

import { planClassification } from "../../src/lib/mergeClassification";
import type { Finding } from "../../src/types";

function localFinding(category: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id: `local-${category}`,
    category,
    confidence: 0.9,
    sourceText: "local text",
    decision: "pending",
    note: "",
    method: "Local rule",
    findingType: "Provision",
    classification: "present",
    severity: "Medium",
    reason: "local",
    playbookExpectation: "expected",
    ...overrides,
  };
}

function aiFinding(category: string): Finding {
  return {
    id: `ai-${category}`,
    category,
    confidence: 0,
    confidenceIndicator: "high",
    sourceText: "Governed by the laws of Georgia.",
    sourceStart: 0,
    sourceEnd: 32,
    evidenceValidation: "exact",
    decision: "pending",
    note: "",
    method: "AI",
    findingType: "Provision",
    classification: "present",
    reason: "model quote",
  };
}

describe("planClassification", () => {
  it("keeps a decided local finding and still stores the model quote for a new category", () => {
    const decided = localFinding("Governing Law", { decision: "accepted", note: "kept" });
    const plan = planClassification(
      "Governed by the laws of Georgia.",
      [decided],
      [aiFinding("Governing Law"), aiFinding("Audit Rights")],
    );

    expect(plan.keptIds).toContain(decided.id);
    expect(plan.replacements).toHaveLength(0);
    expect(plan.inserts.map((finding) => finding.category)).toContain("Audit Rights");
    expect(plan.inserts.some((finding) => finding.category === "Governing Law" && finding.method === "AI")).toBe(false);
  });

  it("replaces an untouched local finding when the model returns that category", () => {
    const pending = localFinding("Governing Law");
    const plan = planClassification("Governed by the laws of Georgia.", [pending], [aiFinding("Governing Law")]);
    expect(plan.replacements).toEqual([{ id: pending.id, finding: expect.objectContaining({ method: "AI" }) }]);
  });

  it("leaves stored findings in place when the model returns nothing", () => {
    const pending = localFinding("Governing Law");
    const plan = planClassification("Governed by the laws of Georgia.", [pending], []);
    expect(plan).toEqual({ keptIds: [pending.id], replacements: [], inserts: [] });
  });
});
