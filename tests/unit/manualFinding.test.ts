import { describe, expect, it } from "vitest";

import {
  auditFindingUpdate,
  createManualFinding,
  validateManualFinding,
  type ManualFindingInput,
} from "../../src/lib/manualFinding";

const reviewer = "reviewer@example.test";
const agreementText =
  "Section 4. Governing law is the law of New York. Section 9. Either party may terminate on notice.";
const validProvision: ManualFindingInput = {
  category: "Governing Law",
  findingType: "Provision",
  severity: "High",
  reason: "The clause selects an unexpected governing law.",
  sourceText: "Governing law is the law of New York.",
  playbookExpectation: "",
  creator: reviewer,
};

describe("manual finding validation", () => {
  it("requires common fields and exact evidence for a provision", () => {
    expect(
      validateManualFinding(
        {
          ...validProvision,
          category: "",
          severity: "" as ManualFindingInput["severity"],
          reason: " ",
          sourceText: "not in agreement",
          creator: "",
        },
        agreementText,
      ),
    ).toMatchObject({
      category: "Choose a playbook category.",
      severity: "Choose a severity.",
      reason: "Enter a reason.",
      sourceText: "Supporting text must match text in the agreement exactly.",
      creator: "A creator is required.",
    });
  });

  it("requires a playbook expectation and forbids contract text on a gap", () => {
    const gap: ManualFindingInput = {
      ...validProvision,
      findingType: "Gap",
      sourceText: "invented contract text",
      playbookExpectation: "",
    };
    expect(
      validateManualFinding(
        {
          ...gap,
          sourceText: "",
          playbookExpectation: "The agreement must specify governing law.",
        },
        agreementText,
      ),
    ).toEqual({});
    expect(validateManualFinding(gap, agreementText)).toMatchObject({
      sourceText: "Gap findings cannot include invented contract text.",
      playbookExpectation: "Reference the applicable playbook expectation.",
    });
  });

  it("keeps decisions in the audited snapshot when a flag is edited", () => {
    const created = createManualFinding(validProvision);
    const accepted = auditFindingUpdate(created, { decision: "accepted" }, reviewer);
    const edited = auditFindingUpdate(
      accepted,
      { reason: "Updated reviewer explanation." },
      reviewer,
    );

    expect(edited.decision).toBe("accepted");
    expect(edited.history?.map((entry) => entry.action)).toEqual([
      "created",
      "decision",
      "edited",
    ]);
    expect(edited.history?.[2].before?.decision).toBe("accepted");
  });
});
