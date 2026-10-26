// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "../../src/App";
import { finishReview, ownsAgreement, requesterSubmissions, reviseAgreement } from "../../src/lib/requesterTracker";
import type { Agreement } from "../../src/types";

const agreement = (patch: Partial<Agreement> = {}): Agreement => ({
  id: "alice-agreement", name: "Alice agreement", vendor: "Alice vendor",
  agreementType: "Master services agreement", businessUnit: "Shared services",
  submittedAt: "2026-10-01T12:00:00Z", submittedBy: "alice@example.test",
  neededBy: "2026-12-01", currentVersion: 2,
  versions: [{ version: 2, fileName: "alice-v2.txt", uploadedAt: "2026-10-02T12:00:00Z" }],
  status: "Approved with conditions", completedAt: "2026-10-03T12:00:00Z",
  conditions: ["Provide proof of insurance."], rawText: "PRIVATE CONTRACT TEXT",
  findings: [{ id: "internal", category: "Governing Law", confidence: 1, sourceText: "Georgia", decision: "accepted", note: "PRIVATE LEGAL NOTE", method: "Manual" }],
  ...patch,
});

afterEach(() => { cleanup(); localStorage.clear(); });

function requesterView(records: Agreement[]) {
  localStorage.setItem("clausepilot-agreements-v1", JSON.stringify(records));
  render(<App />);
  fireEvent.change(screen.getByLabelText("Viewing as"), { target: { value: "Requester" } });
  fireEvent.change(screen.getByLabelText("Prototype Requester profile"), { target: { value: "alice@example.test" } });
}

describe("requester data boundary", () => {
  it("matches exact normalized owners and denies blank, missing and other owners", () => {
    expect(ownsAgreement(agreement(), " ALICE@EXAMPLE.TEST ")).toBe(true);
    for (const owner of ["", " ", "alice", "bob@example.test"]) expect(ownsAgreement(agreement(), owner)).toBe(false);
    expect(ownsAgreement(agreement({ submittedBy: undefined as unknown as string }), "alice@example.test")).toBe(false);
    expect(ownsAgreement(agreement({ submittedBy: "" }), "")).toBe(false);
  });

  it("returns only owned public fields and never includes findings, raw text or notes", () => {
    const records = requesterSubmissions([agreement(), agreement({ id: "bob", submittedBy: "bob@example.test" })], "alice@example.test");
    expect(records).toHaveLength(1);
    expect(records[0].conditions).toEqual(["Provide proof of insurance."]);
    expect(records[0]).not.toHaveProperty("findings");
    expect(records[0]).not.toHaveProperty("rawText");
    expect(JSON.stringify(records)).not.toContain("PRIVATE");
    expect(requesterSubmissions([agreement({ completedAt: undefined })], "alice@example.test")[0].conditions).toEqual([]);
  });

  it("blocks cross-owner revision attempts without mutating the original", () => {
    const original = agreement();
    expect(() => reviseAgreement(original, "bob@example.test", "new.txt", { text: "new", warnings: [] }, "2026-10-04T12:00:00Z")).toThrow(/does not belong/);
    expect(original.currentVersion).toBe(2);
    expect(original.status).toBe("Approved with conditions");
  });

  it("increments revisions, keeps history and invalidates the old outcome and findings", () => {
    const original = agreement();
    const revised = reviseAgreement(original, "alice@example.test", "new.txt", { text: "Governed by the laws of Georgia.", warnings: [] }, "2026-10-04T12:00:00Z");
    expect(revised.currentVersion).toBe(3);
    expect(revised.versions?.map((item) => item.version)).toEqual([2, 3]);
    expect(revised.status).toBe("Needs review");
    expect(revised.completedAt).toBeUndefined();
    expect(revised.conditions).toEqual([]);
    expect(revised.findings.some((item) => item.note.includes("PRIVATE"))).toBe(false);
    expect(original.currentVersion).toBe(2);
  });

  it("preserves a baseline history when revising older unversioned submissions", () => {
    const revised = reviseAgreement(agreement({ currentVersion: undefined, versions: undefined }), "alice@example.test", "new.txt", { text: "new", warnings: [] }, "2026-10-04T12:00:00Z");
    expect(revised.currentVersion).toBe(2);
    expect(revised.versions?.map((item) => item.version)).toEqual([1, 2]);
  });
});

describe("review outcomes", () => {
  it("requires completed finding decisions and explicit conditions for conditional approval", () => {
    expect(() => finishReview(agreement({ findings: [{ ...agreement().findings[0], decision: "pending" }] }), "Approved", "", "now")).toThrow(/every finding/);
    expect(() => finishReview(agreement(), "Approved with conditions", " \n ", "now")).toThrow(/conditions/);
    expect(() => finishReview(agreement(), "Approved", "Get insurance", "now")).toThrow(/Approved with conditions/);
  });

  it.each(["Approved", "Approved with conditions", "Escalated", "Rejected", "Returned for changes"] as const)("records %s and only explicitly shared conditions", (outcome) => {
    const result = finishReview(agreement(), outcome, outcome === "Approved" ? "" : " First condition \n\n Second condition ", "2026-10-04T12:00:00Z");
    expect(result.status).toBe(outcome);
    expect(result.completedAt).toBe("2026-10-04T12:00:00Z");
    expect(result.conditions).toEqual(outcome === "Approved" ? [] : ["First condition", "Second condition"]);
    expect(result.conditions?.join()).not.toContain("PRIVATE LEGAL NOTE");
  });
});

describe("requester tracker integration", () => {
  it("shows all required columns, final outcome and conditions without another owner's data", () => {
    requesterView([agreement(), agreement({ id: "bob", name: "Bob confidential agreement", vendor: "Bob vendor", submittedBy: "bob@example.test" })]);
    for (const column of ["Vendor", "Submission date", "Needed-by date", "Status", "Current version"]) expect(screen.getByRole("columnheader", { name: column })).toBeTruthy();
    expect(screen.getByText("Dec 1, 2026")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Version 2" })).toBeTruthy();
    expect(screen.getByText("Provide proof of insurance.")).toBeTruthy();
    expect(screen.getByText("Oct 3, 2026")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Bob");
    expect(document.body.textContent).not.toContain("PRIVATE");
    expect(screen.queryByLabelText("Reviewer note")).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete review" })).toBeNull();
    const nav = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    expect(nav.queryByRole("button", { name: /Review queue|Reports/ })).toBeNull();
    fireEvent.click(nav.getByRole("button", { name: "Overview" }));
    expect(document.body.textContent).not.toContain("Bob");
    expect(screen.getByRole("heading", { name: "My submissions" })).toBeTruthy();
  });

  it("clears selection and conditions when switching to another requester or a blank identity", () => {
    requesterView([agreement(), agreement({ id: "bob", name: "Bob agreement", vendor: "Bob vendor", submittedBy: "bob@example.test", conditions: ["Bob condition"] })]);
    fireEvent.change(screen.getByLabelText("Prototype Requester profile"), { target: { value: "bob@example.test" } });
    expect(screen.getByText("Bob condition")).toBeTruthy();
    expect(screen.queryByText("Provide proof of insurance.")).toBeNull();
    expect(screen.queryByText("Alice vendor")).toBeNull();
    fireEvent.change(screen.getByLabelText("Prototype Requester profile"), { target: { value: "" } });
    expect(screen.getByRole("heading", { name: "No submissions for this Requester" })).toBeTruthy();
    expect(screen.queryByText("Bob condition")).toBeNull();
  });

  it("handles missing legacy metadata without inventing a needed-by date or version", () => {
    requesterView([agreement({ neededBy: undefined, currentVersion: undefined, versions: undefined, completedAt: undefined })]);
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    expect(screen.getByText("Review not completed")).toBeTruthy();
    expect(screen.queryByText("Provide proof of insurance.")).toBeNull();
  });

  it("saves reviewer conditions and exposes them separately from internal notes", () => {
    localStorage.setItem("clausepilot-agreements-v1", JSON.stringify([agreement({ submittedBy: "Prototype user", completedAt: undefined, status: "In review", conditions: [] })]));
    render(<App />);
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /Review queue/ }));
    fireEvent.change(screen.getByLabelText("Final outcome"), { target: { value: "Approved with conditions" } });
    fireEvent.change(screen.getByLabelText("Requester-visible conditions"), { target: { value: "Provide current insurance." } });
    fireEvent.click(screen.getByRole("button", { name: "Complete review" }));
    fireEvent.change(screen.getByLabelText("Viewing as"), { target: { value: "Requester" } });
    expect(screen.getByText("Provide current insurance.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("PRIVATE LEGAL NOTE");
    const stored = JSON.parse(localStorage.getItem("clausepilot-agreements-v1")!)[0];
    expect(stored.conditions).toEqual(["Provide current insurance."]);
    expect(stored.findings[0].note).toBe("PRIVATE LEGAL NOTE");
  });
});
