/**
 * @vitest-environment jsdom
 *
 * Manual flags (pull request #7), now saved through the API. The validation
 * rules are shared with the server, which enforces them again; the
 * integration tests cover that side.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../src/App";
import { normalizeManualFinding, validateManualFinding } from "../../src/lib/manualFinding";
import type { ManualFindingInput } from "../../src/shared/api";
import { fakeApi, makeAgreement, makeRuleFinding, me, resetFakeApi, seed, signedInUser, stored } from "./support/fakeApi";

vi.mock("../../src/lib/api", async () => (await import("./support/fakeApi")).mockApiModule());

const agreementText = "Section 4. Governing law is the law of New York. Section 9. Either party may terminate on notice.";
const validProvision: ManualFindingInput = {
  category: "Governing Law",
  findingType: "provision",
  severity: "high",
  reason: "The clause selects an unexpected governing law.",
  sourceText: "Governing law is the law of New York.",
  playbookExpectation: "",
};

beforeEach(() => resetFakeApi());
afterEach(() => cleanup());

async function openQueue() {
  render(<App user={signedInUser} views={["Requester", "Reviewer"]} onSignOut={() => {}} />);
  const nav = await screen.findByRole("navigation", { name: /primary navigation/i });
  await userEvent.click(within(nav).getByRole("button", { name: /review queue/i }));
}

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
        },
        agreementText,
      ),
    ).toMatchObject({
      category: "Choose a playbook category.",
      severity: "Choose a severity.",
      reason: "Enter a reason.",
      sourceText: "Supporting text must match text in the agreement exactly.",
    });
  });

  it("requires a playbook expectation and forbids contract text on a gap", () => {
    const gap: ManualFindingInput = {
      ...validProvision,
      findingType: "gap",
      sourceText: "invented contract text",
      playbookExpectation: "",
    };

    expect(
      validateManualFinding({ ...gap, sourceText: "", playbookExpectation: "The agreement must specify governing law." }, agreementText),
    ).toEqual({});
    expect(validateManualFinding(gap, agreementText)).toMatchObject({
      sourceText: "Gap findings cannot include invented contract text.",
      playbookExpectation: "Reference the applicable playbook expectation.",
    });
  });

  it("keeps only the fields a flag's type uses", () => {
    expect(normalizeManualFinding({ ...validProvision, playbookExpectation: "stale", reason: "  Why.  " })).toMatchObject({
      playbookExpectation: "",
      reason: "Why.",
      sourceText: validProvision.sourceText,
    });
    expect(normalizeManualFinding({ ...validProvision, findingType: "gap", playbookExpectation: "Expected." })).toMatchObject({
      sourceText: "",
      playbookExpectation: "Expected.",
    });
  });
});

describe("reviewing manual flags", () => {
  it("requires a reviewer reason before a decision can be recorded", async () => {
    const agreement = makeAgreement({ rawText: agreementText, findings: [makeRuleFinding()] });
    seed(agreement);
    await openQueue();

    expect((await screen.findByRole("button", { name: "Accept" })).hasAttribute("disabled")).toBe(true);

    await userEvent.type(screen.getByLabelText("Reviewer note"), "This provision is materially relevant and should be accepted");
    expect(screen.getByRole("button", { name: "Accept" }).hasAttribute("disabled")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(stored()[0]!.findings[0]).toMatchObject({
      decision: "accepted",
      note: "This provision is materially relevant and should be accepted",
    });
  });

  it("blocks a submitter from reviewing their own agreement", async () => {
    seed(makeAgreement({ rawText: agreementText, submittedBy: me, findings: [makeRuleFinding()] }));
    await openQueue();

    expect(await screen.findByText(/You cannot review your own agreement/i)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: /add manual flag/i })).toBeNull();
  });

  it("saves category, type, severity, reason, evidence, creator, and edit history", async () => {
    const agreement = makeAgreement({ rawText: agreementText, findings: [] });
    seed(agreement);
    await openQueue();

    await userEvent.click(await screen.findByRole("button", { name: /add manual flag/i }));
    await userEvent.click(screen.getByRole("button", { name: "Create flag" }));
    expect(screen.getByLabelText(/^Exact supporting source text/).getAttribute("aria-invalid")).toBe("true");
    expect(fakeApi.addManualFinding).not.toHaveBeenCalled();

    expect((screen.getByLabelText("Creator") as HTMLInputElement).value).toBe(signedInUser.email);
    await userEvent.selectOptions(screen.getByLabelText("Playbook category"), "Governing Law");
    await userEvent.selectOptions(screen.getByLabelText("Severity"), "High");
    await userEvent.type(screen.getByLabelText(/^Exact supporting source text/), validProvision.sourceText);
    await userEvent.type(screen.getByLabelText(/^Reason/), validProvision.reason);
    await userEvent.click(screen.getByRole("button", { name: "Create flag" }));

    expect(fakeApi.addManualFinding).toHaveBeenCalledWith(agreement.id, validProvision);
    expect(await screen.findByText("Manual origin")).toBeTruthy();
    expect(screen.getAllByText("Provision · High").length).toBeGreaterThan(0);
    expect(screen.getByText("Audit history (1)")).toBeTruthy();
    let saved = stored()[0]!.findings[0]!;
    expect(saved).toMatchObject({ ...validProvision, method: "manual", createdBy: { email: signedInUser.email } });

    await userEvent.click(screen.getByRole("button", { name: "Edit manual flag" }));
    const nextReason = "Updated reason after review.";
    await userEvent.clear(screen.getByLabelText(/^Reason/));
    await userEvent.type(screen.getByLabelText(/^Reason/), nextReason);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Audit history (2)")).toBeTruthy();
    saved = stored()[0]!.findings[0]!;
    expect(saved.reason).toBe(nextReason);
    expect(saved.history.map((entry) => entry.action)).toEqual(["created", "edited"]);
    expect(saved.history[1]).toMatchObject({ actor: { email: signedInUser.email } });
  });

  it("creates a gap flag without contract evidence", async () => {
    seed(makeAgreement({ rawText: agreementText, findings: [] }));
    await openQueue();

    await userEvent.click(await screen.findByRole("button", { name: /add manual flag/i }));
    await userEvent.selectOptions(screen.getByLabelText("Finding type"), "Gap");
    expect(screen.queryByLabelText(/^Exact supporting source text/)).toBeNull();
    await userEvent.type(screen.getByLabelText(/^Applicable playbook expectation/), "The agreement should identify the governing law.");
    await userEvent.type(screen.getByLabelText(/^Reason/), "No governing-law clause is present.");
    await userEvent.click(screen.getByRole("button", { name: "Create flag" }));

    expect(await screen.findByText("No contract text cited for this gap.")).toBeTruthy();
    expect(stored()[0]!.findings[0]).toMatchObject({
      findingType: "gap",
      sourceText: "",
      playbookExpectation: "The agreement should identify the governing law.",
    });
  });

  it("keeps the form open and explains a refusal from the server", async () => {
    seed(makeAgreement({ rawText: agreementText, findings: [] }));
    await openQueue();
    const { ApiRequestError } = await vi.importActual<typeof import("../../src/lib/api")>("../../src/lib/api");
    fakeApi.addManualFinding.mockRejectedValueOnce(new ApiRequestError(409, "This review is already complete."));

    await userEvent.click(await screen.findByRole("button", { name: /add manual flag/i }));
    await userEvent.type(screen.getByLabelText(/^Exact supporting source text/), validProvision.sourceText);
    await userEvent.type(screen.getByLabelText(/^Reason/), validProvision.reason);
    await userEvent.click(screen.getByRole("button", { name: "Create flag" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This review is already complete.");
    expect(screen.getByRole("button", { name: "Create flag" })).toBeTruthy();
    expect((screen.getByLabelText(/^Reason/) as HTMLTextAreaElement).value).toBe(validProvision.reason);
  });

  it("shows a decision change in the history", async () => {
    seed(makeAgreement({ rawText: agreementText, findings: [makeRuleFinding({ note: "Looks standard." })] }));
    await openQueue();

    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await userEvent.click(screen.getByRole("button", { name: "Escalate" }));

    expect(await screen.findByText("Audit history (2)")).toBeTruthy();
    expect(screen.getByText(/escalated \(previously accepted\)/)).toBeTruthy();
  });
});
