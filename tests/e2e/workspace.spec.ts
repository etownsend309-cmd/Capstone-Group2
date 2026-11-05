import { readFileSync } from "node:fs";
import { expect, test } from "./support/session";
import { segmentAgreement } from "../../src/lib/segmentAgreement";
import type { IngestionRecord } from "../../src/shared/ingestion";

const text = "1. Governing Law\nGeorgia law applies.\n\n2. Audit\nRecords remain available.";

test("opens the original and navigates from a finding to verified source evidence", async ({ page, server }) => {
  const agreement = server.addAgreement({ name: "Workspace sample", rawText: text });
  const pages = [{ pageNumber: 1, startOffset: 0, endOffset: text.length }];
  const segments = segmentAgreement(agreement.id, 1, text, pages);
  const record: IngestionRecord = { agreementId: agreement.id, version: 1, state: "ready", error: null, segmentCount: segments.length, source: "extracted", text,
    pages, segments, pageCount: 1, strategy: "coordinate", warnings: [] };
  agreement.ingestion = record;
  agreement.documents = [{ id: "workspace-document", fileName: "workspace.pdf", contentType: "application/pdf", byteSize: 20, uploadedAt: new Date().toISOString() }];
  agreement.findings = [{ ...agreement.findings[0]!, id: "source-finding", category: "Governing Law", findingType: "provision", classification: "present", sourceText: "Georgia law applies.", history: [], note: "Internal reviewer assessment" }];
  await page.route(`**/api/agreements/${agreement.id}`, (route) => route.fulfill({ json: agreement }));
  await page.route(`**/api/agreements/${agreement.id}/ingestion`, (route) => route.fulfill({ json: record }));
  await page.route("**/api/documents/workspace-document", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: readFileSync(new URL("../../fixtures/generated/clean-agreement.pdf", import.meta.url)) }));
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Review queue" }).click();
  await expect(page.getByRole("heading", { name: "Workspace sample" })).toBeVisible();
  await page.getByRole("button", { name: "Go to cited text" }).click();
  await expect(page.getByLabel("Cited source text")).toHaveText("Georgia law applies.");
  await expect(page.getByLabel("Cited source text")).toBeFocused();
  await expect(page.locator(".source-navigation")).toContainText("Section 1 · Page 1");
  await expect(page.getByTitle("Original document: workspace.pdf")).toHaveAttribute("src", /blob:.*#page=1$/);
  await page.setViewportSize({ width: 820, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("keeps manual document inspection available when extraction failed and supports supplied-text recovery", async ({ page, server }) => {
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "New agreement" }).click();
  await page.getByLabel("Agreement document", { exact: true }).setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nunreadable") });
  await page.getByLabel("Vendor", { exact: false }).fill("Synthetic vendor");
  await page.getByLabel("Agreement type", { exact: false }).fill("Services");
  await page.getByLabel("Business unit", { exact: false }).fill("IT");
  await page.getByLabel("Needed-by date", { exact: false }).fill("2026-12-01");
  await page.getByRole("button", { name: /Create review/ }).click();
  await expect(page.getByText("Text preparation failed", { exact: true })).toBeVisible();
  await page.route("**/api/documents/*", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: readFileSync(new URL("../../fixtures/generated/clean-agreement.pdf", import.meta.url)) }));
  await page.getByRole("navigation").getByRole("button", { name: "Review queue" }).click();
  await expect(page.getByText("Extracted text unavailable.")).toBeVisible();
  await expect(page.getByRole("link", { name: "scan.pdf" })).toBeVisible();
  await expect(page.getByTitle("Original document: scan.pdf")).toBeVisible();
  await page.getByLabel("Supplied agreement text").fill(text);
  await page.getByRole("button", { name: "Use supplied text" }).click();
  await expect(page.getByRole("heading", { name: "Supplied agreement text" })).toBeVisible();
  await expect(page.getByLabel("Full agreement text")).toContainText("Georgia law applies.");
  expect(server.agreements()).toHaveLength(1);
});

test("retains full source text when the original document cannot be retrieved", async ({ page, server }) => {
  const agreement = server.addAgreement({ name: "Unavailable original", rawText: text });
  agreement.documents = [{ id: "denied", fileName: "missing.pdf", contentType: "application/pdf", byteSize: 10, uploadedAt: new Date().toISOString() }];
  await page.route(`**/api/agreements/${agreement.id}`, (route) => route.fulfill({ json: agreement }));
  await page.route("**/api/documents/denied", (route) => route.fulfill({ status: 403, json: { error: "Access refused" } }));
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "Review queue" }).click();
  await expect(page.getByText("The original file could not be opened. Check access or retry.")).toBeVisible();
  await expect(page.getByLabel("Full agreement text")).toContainText(text);
  await expect(page.getByRole("button", { name: "Retry original document" })).toBeVisible();
});
