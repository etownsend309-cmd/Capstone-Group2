/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "../../src/App";
import {
  auditFindingUpdate,
  createManualFinding,
  validateManualFinding,
  type ManualFindingInput,
} from "../../src/lib/manualFinding";
import type { Finding } from "../../src/types";

const STORAGE_KEY = "clausepilot-agreements-v1";
const signedInUser = { id: "reviewer-id", email: "reviewer@example.test" };
const agreementText = "Section 4. Governing law is the law of New York. Section 9. Either party may terminate on notice.";
const validProvision: ManualFindingInput = {
  category: "Governing Law",
  findingType: "Provision",
  severity: "High",
  reason: "The clause selects an unexpected governing law.",
  sourceText: "Governing law is the law of New York.",
  playbookExpectation: "",
  creator: signedInUser.email,
};

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe("manual finding validation", () => {
  it("requires all common fields and exact evidence for provision", () => {
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
        { ...gap, sourceText: "", playbookExpectation: "The agreement must specify governing law." },
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
    const accepted = auditFindingUpdate(created, { decision: "accepted" }, signedInUser.email);
    const edited = auditFindingUpdate(accepted, { reason: "Updated reviewer explanation." }, signedInUser.email);

    expect(edited.decision).toBe("accepted");
    expect(edited.history?.map((entry) => entry.action)).toEqual(["created", "decision", "edited"]);
    expect(edited.history?.[1].after.decision).toBe("accepted");
    expect(edited.history?.[2].before?.decision).toBe("accepted");
  });
});

describe("manual finding persistence", () => {
  it("persists category, type, severity, reason, evidence, creator, and edit history", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "agreement-1",
          name: "Northstar agreement",
          vendor: "Northstar",
          agreementType: "MSA",
          businessUnit: "Legal",
          neededBy: "2026-12-01",
          submittedAt: "2026-10-01T10:00:00.000Z",
          submittedBy: signedInUser.email,
          status: "Needs review",
          rawText: agreementText,
          findings: [],
        },
      ]),
    );

    render(<App user={signedInUser} onSignOut={() => {}} />);

    const navigation = screen.getByRole("navigation", { name: /primary navigation/i });
    await userEvent.click(navigation.querySelector('[aria-label^="Review queue"]') as HTMLButtonElement);
    await userEvent.click(screen.getByRole("button", { name: /add manual flag/i }));
    await userEvent.selectOptions(screen.getByLabelText("Playbook category"), "Governing Law");
    await userEvent.selectOptions(screen.getByLabelText("Severity"), "High");
    await userEvent.type(screen.getByLabelText("Exact supporting source text"), validProvision.sourceText);
    await userEvent.type(screen.getByLabelText("Reason"), validProvision.reason);
    await userEvent.click(screen.getByRole("button", { name: "Create flag" }));

    let saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")[0].findings[0] as Finding;
    expect(saved).toMatchObject({
      category: validProvision.category,
      findingType: validProvision.findingType,
      severity: validProvision.severity,
      reason: validProvision.reason,
      sourceText: validProvision.sourceText,
      creator: signedInUser.email,
      method: "Manual",
    });

    expect(saved.history).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Edit manual flag" }));
    const nextReason = "Updated reason after review.";
    await userEvent.clear(screen.getByLabelText("Reason"));
    await userEvent.type(screen.getByLabelText("Reason"), nextReason);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")[0].findings[0] as Finding;
    expect(saved.reason).toBe(nextReason);
    expect(saved.history).toHaveLength(2);
    expect(saved.history?.[1]).toMatchObject({ action: "edited", actor: signedInUser.email });
  });
});