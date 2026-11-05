// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceWorkspace } from "../../src/components/SourceWorkspace";
import { api } from "../../src/lib/api";
import { makeAgreement } from "./support/fakeApi";

vi.mock("../../src/lib/api", async () => (await import("./support/fakeApi")).mockApiModule());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => vi.clearAllMocks());

it("highlights the exact citation and lets the reviewer choose repeated occurrences", async () => {
  const agreement = makeAgreement({ rawText: "Georgia law. Other terms. Georgia law." });
  const finding = { ...agreement.findings[0]!, id: "citation", findingType: "provision" as const, sourceText: "Georgia law." };
  render(<SourceWorkspace agreement={agreement} finding={finding} />);
  await userEvent.click(screen.getByRole("button", { name: "Go to cited text" }));
  expect(screen.getByLabelText("Cited source text").textContent).toBe("Georgia law.");
  await userEvent.selectOptions(screen.getByLabelText("Citation occurrence"), "1");
  expect(screen.getByText(/Characters 26–38/)).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText("Cited source text"));
});

it("never highlights a fabricated citation or a gap", () => {
  const agreement = makeAgreement({ rawText: "Georgia law." });
  const finding = { ...agreement.findings[0]!, sourceText: "Georgia…", findingType: "provision" as const };
  const { rerender } = render(<SourceWorkspace agreement={agreement} finding={finding} />);
  expect(screen.getByText(/No location has been guessed/)).toBeTruthy();
  rerender(<SourceWorkspace agreement={agreement} finding={{ ...finding, findingType: "gap", sourceText: "Georgia law." }} />);
  expect(screen.queryByRole("button", { name: "Go to cited text" })).toBeNull();
  expect(screen.getByText(/No source span applies/)).toBeTruthy();
});

it("keeps the original available when extraction is missing and handles denied access", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
  const agreement = makeAgreement({ rawText: "", documents: [{ id: "file", fileName: "scan.pdf", contentType: "application/pdf", byteSize: 10, uploadedAt: new Date().toISOString() }] });
  render(<SourceWorkspace agreement={agreement} />);
  expect(screen.getByText("Extracted text unavailable.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "scan.pdf" }).getAttribute("href")).toBe("/api/documents/file");
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry original document" })).toBeTruthy();
});

it("displays original TXT as plain text rather than executing markup", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode("<script>private</script>").buffer }));
  const agreement = makeAgreement({ documents: [{ id: "txt", fileName: "terms.txt", contentType: "text/plain", byteSize: 30, uploadedAt: new Date().toISOString() }] });
  render(<SourceWorkspace agreement={agreement} />);
  expect(await screen.findByText("<script>private</script>")).toBeTruthy();
  expect(document.querySelector("script")).toBeNull();
});

it("uses only matching agreement and version metadata", async () => {
  const agreement = makeAgreement({ rawText: "Georgia law.", ingestion: { version: 2, state: "ready", segmentCount: 1, error: null } });
  vi.mocked(api.getIngestion).mockResolvedValueOnce({ ...agreement.ingestion!, agreementId: "wrong-agreement", version: 1, source: "extracted", text: agreement.rawText,
    pages: [{ pageNumber: 3, startOffset: 0, endOffset: agreement.rawText.length }], segments: [], pageCount: 3, strategy: null, warnings: [] });
  render(<SourceWorkspace agreement={agreement} finding={{ ...agreement.findings[0]!, sourceText: "Georgia law." }} />);
  await waitFor(() => expect(api.getIngestion).toHaveBeenCalledWith(agreement.id));
  expect(screen.getByText(/Page location unavailable/)).toBeTruthy();
});
