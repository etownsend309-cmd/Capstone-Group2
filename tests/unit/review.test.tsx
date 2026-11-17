/**
 * @vitest-environment jsdom
 *
 * The review queue and reports, driven against the in-memory API fake.
 * Each action must go to the server, and the screen must show the server's
 * answer, including its refusals.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../../src/App";
import { ApiRequestError } from "../../src/lib/api";
import type { Role } from "../../src/types";
import { fakeApi, makeAgreement, makeRuleFinding, resetFakeApi, seed, signedInUser, stored } from "./support/fakeApi";
import type { AgreementDetail } from "../../src/shared/api";

vi.mock("../../src/lib/api", async () => (await import("./support/fakeApi")).mockApiModule());

const TWO_FINDINGS =
  "GOVERNING LAW. This Agreement is governed by the laws of Georgia. Vendor may not assign this Agreement without prior written consent.";

beforeEach(() => resetFakeApi());
afterEach(() => cleanup());

async function openQueue(views: Role[] = ["Requester", "Reviewer", "Approver"]) {
  render(<App user={signedInUser} views={views} onSignOut={() => {}} />);
  const nav = await screen.findByRole("navigation", { name: /primary navigation/i });
  await userEvent.click(within(nav).getByRole("button", { name: /review queue/i }));
}

const detailPanel = () => document.querySelector<HTMLElement>(".review-detail")!;

/** An agreement whose findings already carry a reviewer note, so a decision can be recorded at once. */
const noted = (overrides: Partial<AgreementDetail> = {}) => {
  const agreement = makeAgreement(overrides);
  for (const finding of agreement.findings) finding.note = "Reviewed against the playbook.";
  return agreement;
};

describe("review queue", () => {
  it("records a decision on the server and moves the agreement into review", async () => {
    const agreement = noted({ rawText: TWO_FINDINGS });
    seed(agreement);
    await openQueue();

    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));

    expect(fakeApi.decideFinding).toHaveBeenCalledWith(agreement.findings[0]!.id, { decision: "accepted", note: "Reviewed against the playbook." });
    expect(stored()[0]!.findings[0]!.decision).toBe("accepted");
    expect(await within(detailPanel()).findByText("In review")).toBeTruthy();
    expect(screen.getByText("1 findings still need a decision")).toBeTruthy();
  });

  it("saves a reviewer note when the field loses focus, keeping the decision", async () => {
    const agreement = makeAgreement();
    seed(agreement);
    await openQueue();

    await userEvent.type(await screen.findByLabelText("Reviewer note"), "Matches our standard clause.");
    expect(fakeApi.decideFinding).not.toHaveBeenCalled();
    await userEvent.tab();

    expect(fakeApi.decideFinding).toHaveBeenCalledWith(agreement.findings[0]!.id, {
      decision: "pending",
      note: "Matches our standard clause.",
    });
    expect(stored()[0]!.findings[0]!.note).toBe("Matches our standard clause.");
  });

  it("sends an unsaved note along with the decision", async () => {
    const agreement = makeAgreement();
    seed(agreement);
    await openQueue();

    await userEvent.type(await screen.findByLabelText("Reviewer note"), "Out of policy.");
    await userEvent.click(screen.getByRole("button", { name: "Escalate" }));

    expect(fakeApi.decideFinding).toHaveBeenLastCalledWith(agreement.findings[0]!.id, { decision: "escalated", note: "Out of policy." });
    expect(stored()[0]!.findings[0]).toMatchObject({ decision: "escalated", note: "Out of policy." });
  });

  it("saves an unsaved note before completing the review", async () => {
    const agreement = noted();
    seed(agreement);
    await openQueue();

    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await userEvent.clear(screen.getByLabelText("Reviewer note"));
    await userEvent.type(screen.getByLabelText("Reviewer note"), "Checked against the playbook.");
    await userEvent.click(screen.getByRole("button", { name: "Complete review" }));

    expect(await within(detailPanel()).findByText("Approved")).toBeTruthy();
    expect(stored()[0]!.findings[0]).toMatchObject({ decision: "accepted", note: "Checked against the playbook." });
  });

  it("adds a manual flag and selects it", async () => {
    const agreement = makeAgreement();
    seed(agreement);
    await openQueue();

    await userEvent.click(await screen.findByRole("button", { name: /add manual flag/i }));
    await userEvent.selectOptions(screen.getByLabelText("Playbook category"), "Audit Rights");
    await userEvent.selectOptions(screen.getByLabelText("Finding type"), "Gap");
    await userEvent.type(screen.getByLabelText("Applicable playbook expectation"), "Customer may audit vendor records yearly.");
    await userEvent.type(screen.getByLabelText("Reason"), "No audit clause.");
    await userEvent.click(screen.getByRole("button", { name: "Create flag" }));

    expect(fakeApi.addManualFinding).toHaveBeenCalledWith(agreement.id, {
      category: "Audit Rights",
      findingType: "gap",
      severity: "medium",
      reason: "No audit clause.",
      sourceText: "",
      playbookExpectation: "Customer may audit vendor records yearly.",
    });
    expect(await screen.findByRole("heading", { name: "Audit Rights" })).toBeTruthy();
    expect(screen.getByText("Manual origin")).toBeTruthy();
    // The reason doubles as the first note, so a decision can follow straight away.
    expect((screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the server's reason when completing a review is refused", async () => {
    seed(noted());
    await openQueue(["Requester", "Reviewer"]);
    fakeApi.completeReview.mockRejectedValueOnce(new ApiRequestError(403, "Approving an agreement requires the Approver permission."));

    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await userEvent.click(screen.getByRole("button", { name: "Complete review" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Approving an agreement requires the Approver permission.");
    expect(stored()[0]!.status).toBe("in_review");
  });

  it("completes a review and then shows it read-only", async () => {
    seed(noted());
    await openQueue();

    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await userEvent.click(screen.getByRole("button", { name: "Complete review" }));

    expect(await within(detailPanel()).findByText("Approved")).toBeTruthy();
    expect(stored()[0]!.status).toBe("approved");
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete review" })).toBeNull();
    expect((screen.getByLabelText("Reviewer note") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("gives the Requester view no review controls", async () => {
    seed(makeAgreement());
    await openQueue(["Requester"]);

    expect(await screen.findByText(/Supporting source text/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect((screen.getByLabelText("Reviewer note") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("shows the sealed holdout count for a matching AI run", async () => {
    const agreement = makeAgreement({
      findings: [
        makeRuleFinding({
          method: "ai",
          confidence: 0,
          confidenceIndicator: "high",
          findingType: "provision",
          classification: "present",
          sourceText: "Governed by the laws of Georgia.",
          reason: "The model returned this quote and it matched the stored agreement text exactly. The confidence indicator is the model's own assessment and is not calibrated.",
          classificationRun: {
            requestedModel: "gpt-5.6-terra",
            promptVersion: "clausepilot-classifier-v1",
            schemaVersion: "classifier-output-v1",
          },
        }),
      ],
    });
    seed(agreement);
    await openQueue();

    expect(await screen.findByText("high model confidence · calibrated")).toBeTruthy();
    const about = screen.getAllByRole("button", { name: "About the Governing Law confidence rating" });
    await userEvent.click(about[0]!);

    expect(screen.getByText(/high was right 68 of 89 times/)).toBeTruthy();
    expect(screen.getByText(/Medium means the model saw an indirect or qualified match. The checked contracts did not include this rating./)).toBeTruthy();
    expect(screen.getByText(/Low means the model saw a weak but possibly relevant match. The checked contracts did not include this rating./)).toBeTruthy();
  });

  it("keeps not calibrated when the finding used a different model", async () => {
    const agreement = makeAgreement({
      findings: [
        makeRuleFinding({
          method: "ai",
          confidence: 0,
          confidenceIndicator: "high",
          findingType: "provision",
          classification: "present",
          sourceText: "Governed by the laws of Georgia.",
          classificationRun: {
            requestedModel: "other-model",
            promptVersion: "clausepilot-classifier-v1",
            schemaVersion: "classifier-output-v1",
          },
        }),
      ],
    });
    seed(agreement);
    await openQueue();

    expect(await screen.findByText("high model confidence · not calibrated")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "About the Governing Law confidence rating" })[0]!);
    expect(screen.getByText("This finding was not checked against expert-labeled contracts.")).toBeTruthy();
    expect(screen.queryByText(/68 of 89/)).toBeNull();
  });

  it("links to the stored original file", async () => {
    const agreement = makeAgreement({
      documents: [{ id: "d0000000-0000-4000-8000-000000000001", fileName: "msa.pdf", contentType: "application/pdf", byteSize: 10, uploadedAt: "2026-10-01T12:00:00.000Z" }],
    });
    seed(agreement);
    await openQueue();

    const link = await screen.findByRole("link", { name: "msa.pdf" });
    expect(link.getAttribute("href")).toBe("/api/documents/d0000000-0000-4000-8000-000000000001");
  });
});

describe("reports", () => {
  it("shows the server's category counts, busiest first", async () => {
    const agreement = makeAgreement({ rawText: TWO_FINDINGS });
    agreement.findings[1]!.decision = "escalated";
    seed(agreement, makeAgreement());
    render(<App user={signedInUser} views={["Reviewer"]} onSignOut={() => {}} />);

    await userEvent.click(await screen.findByRole("button", { name: "Reports" }));

    expect(await screen.findByText("2 agreements visible to you")).toBeTruthy();
    const rows = [...document.querySelectorAll(".report-row:not(.report-header)")].map((row) =>
      [...row.children].map((cell) => cell.textContent),
    );
    expect(rows[0]).toEqual(["Governing Law", "", "2", "0", "0"]);
    expect(rows[1]).toEqual(["Anti-Assignment", "", "1", "0", "1"]);
    expect(rows).toHaveLength(12);
  });
});
