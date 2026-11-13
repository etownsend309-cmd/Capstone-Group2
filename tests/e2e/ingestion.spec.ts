import { expect, test } from "./support/session";

async function submit(page: import("@playwright/test").Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: "New agreement" }).click();
  await page.getByLabel("Agreement document", { exact: true }).setInputFiles(file);
  await page.getByLabel("Vendor", { exact: false }).fill("Synthetic vendor");
  await page.getByLabel("Agreement type", { exact: false }).fill("Services");
  await page.getByLabel("Business unit", { exact: false }).fill("IT");
  await page.getByLabel("Needed-by date", { exact: false }).fill("2026-12-01");
  await page.getByRole("button", { name: /Create review/ }).click();
  await expect(page.getByRole("heading", { name: "My submissions" })).toBeVisible();
}

const text = "1. Governing Law\nGeorgia law applies.\n\n2. Audit Rights\nCustomer may audit records.";

test("prepares ordered exact source sections and retains them after reload", async ({ page, server }) => {
  await submit(page, { name: "segmented.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.getByText("Text ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View source sections" }).click();
  const sections = page.locator(".ingestion-panel li");
  await expect(sections).toHaveCount(2);
  await expect(sections.first()).toContainText("Section 1");
  await expect(sections.last()).toContainText("Page location unavailable");
  expect(server.agreements()[0]?.findings).toEqual([]);
  await page.reload();
  await page.getByRole("button", { name: "My submissions" }).click();
  await expect(page.getByText("Text ready", { exact: true })).toBeVisible();
});

test("retains a failed extraction and recovers with supplied text without a second submission", async ({ page, server }) => {
  await submit(page, { name: "damaged.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nnot a readable document") });
  await expect(page.getByText("Text preparation failed", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "My submissions" }).click();
  await expect(page.getByText("Text preparation failed", { exact: true })).toBeVisible();
  await page.getByLabel("Supplied agreement text").fill(text);
  await page.getByRole("button", { name: "Use supplied text" }).click();
  await expect(page.getByText("Text ready", { exact: true })).toBeVisible();
  expect(server.agreements()).toHaveLength(1);
  expect(server.agreements()[0]?.rawText).toBe(text);
});

test("interrupted preparation stays pending and retries the privately retrieved original file", async ({ page, server }) => {
  let interrupted = false;
  await page.route("**/api/agreements/*/ingestion", async (route) => {
    if (route.request().method() === "POST" && !interrupted) {
      interrupted = true;
      return route.fulfill({ status: 503, json: { error: "Preparation temporarily unavailable." } });
    }
    return route.fallback();
  });
  await submit(page, { name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.getByRole("status")).toContainText("interrupted");
  await expect(page.getByText("Text preparation pending", { exact: true })).toBeVisible();
  await page.route("**/api/documents/*", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: text }));
  await page.getByRole("button", { name: "Retry saved document" }).click();
  await expect(page.getByText("Text ready", { exact: true })).toBeVisible();
  expect(server.agreements()).toHaveLength(1);
});
