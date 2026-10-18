import { expect, test } from "@playwright/test";

const owned = {
  id: "alice", name: "Alice services agreement", vendor: "Alice vendor",
  submittedBy: "alice@example.test", submittedAt: "2026-10-01T12:00:00Z",
  neededBy: "2026-12-01", currentVersion: 2,
  versions: [{ version: 2, fileName: "alice-v2.txt", uploadedAt: "2026-10-02T12:00:00Z" }],
  status: "Approved with conditions", completedAt: "2026-10-03T12:00:00Z",
  conditions: ["Provide current insurance."], rawText: "PRIVATE CONTRACT CONTENT",
  findings: [{ id: "finding", category: "Governing Law", confidence: 1, sourceText: "Georgia", decision: "accepted", note: "PRIVATE INTERNAL STRATEGY", method: "Manual" }],
};
const other = { ...owned, id: "bob", name: "Bob confidential agreement", vendor: "Bob vendor", submittedBy: "bob@example.test", conditions: ["Bob's private condition"] };

test("requester sees only owned submissions, outcomes and conditions across navigation and identity changes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((records) => localStorage.setItem("clausepilot-agreements-v1", JSON.stringify(records)), [owned, other]);
  await page.goto("/");
  await page.getByLabel("Viewing as").selectOption("Requester");
  await page.getByLabel("Prototype Requester profile").fill("alice@example.test");
  await expect(page.getByRole("heading", { name: "My submissions" })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(2);
  for (const header of ["Vendor", "Submission date", "Needed-by date", "Status", "Current version"]) await expect(table.getByRole("columnheader", { name: header })).toBeVisible();
  await expect(table).toContainText("Alice vendor");
  await expect(table).toContainText("Dec 1, 2026");
  await expect(table).toContainText("Version 2");
  const detail = page.getByRole("region", { name: "Submission details" });
  await expect(detail).toContainText("Approved with conditions");
  await expect(detail).toContainText("Oct 3, 2026");
  await expect(detail).toContainText("Provide current insurance.");
  await expect(page.locator("body")).not.toContainText("Bob");
  await expect(page.locator("body")).not.toContainText("PRIVATE");
  await expect(page.getByLabel("Reviewer note")).toHaveCount(0);
  await expect(page.getByLabel("Requester-visible conditions")).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.getByRole("button", { name: /Reports|Review queue/ })).toHaveCount(0);
  await nav.getByRole("button", { name: "Overview" }).click();
  await expect(page.locator("body")).not.toContainText("Bob");
  await page.getByLabel("Prototype Requester profile").fill("bob@example.test");
  await expect(table).toContainText("Bob vendor");
  await expect(detail).toContainText("Bob's private condition");
  await expect(page.locator("body")).not.toContainText("Alice vendor");
  await expect(page.locator("body")).not.toContainText("Provide current insurance.");
  await page.getByLabel("Prototype Requester profile").fill("");
  await expect(page.getByRole("heading", { name: "No submissions for this Requester" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("new requester submission records owner, needed-by date and version and persists a revision", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Viewing as").selectOption("Requester");
  await page.getByLabel("Prototype Requester profile").fill("alice@example.test");
  await page.getByRole("navigation").getByRole("button", { name: "New agreement" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "initial.txt", mimeType: "text/plain", buffer: Buffer.from("Governed by the laws of Georgia.") });
  await page.getByLabel("Vendor", { exact: true }).fill("Local test vendor");
  await page.getByLabel("Needed-by date").fill("2026-12-01");
  await page.getByRole("button", { name: "Create review →" }).click();
  await expect(page.getByRole("heading", { name: "My submissions" })).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Local test vendor");
  await expect(page.getByRole("table")).toContainText("Dec 1, 2026");
  await expect(page.getByRole("table")).toContainText("Version 1");
  await page.getByLabel("Submit a revised agreement").setInputFiles({ name: "revised.txt", mimeType: "text/plain", buffer: Buffer.from("Governed by the laws of New York.") });
  await expect(page.getByRole("status")).toContainText("New version submitted");
  await expect(page.getByRole("table")).toContainText("Version 2");
  await expect(page.getByRole("table")).toContainText("Needs review");
  await expect(page.getByRole("region", { name: "Submission details" })).toContainText("revised.txt");
  await page.reload();
  await page.getByLabel("Viewing as").selectOption("Requester");
  await expect(page.getByRole("table")).toContainText("Version 2");
  await expect(page.getByRole("region", { name: "Submission details" })).toContainText("Review not completed");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("clausepilot-agreements-v1") ?? "[]"));
  expect(stored[0].submittedBy).toBe("alice@example.test");
  expect(stored[0].neededBy).toBe("2026-12-01");
  expect(stored[0].versions.map((entry: { version: number }) => entry.version)).toEqual([1, 2]);
});

test("reviewer publishes conditions without publishing internal notes and revision clears the old outcome", async ({ page }) => {
  await page.addInitScript((record) => {
    if (!localStorage.getItem("clausepilot-agreements-v1")) localStorage.setItem("clausepilot-agreements-v1", JSON.stringify([record]));
  }, { ...owned, status: "In review", completedAt: undefined, conditions: [] });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: /Review queue/ }).click();
  await expect(page.getByLabel("Reviewer note")).toHaveValue("PRIVATE INTERNAL STRATEGY");
  await page.getByLabel("Final outcome", { exact: true }).selectOption("Approved with conditions");
  await page.getByRole("button", { name: "Complete review" }).click();
  await expect(page.getByRole("alert")).toContainText("Enter the conditions");
  await page.getByLabel("Requester-visible conditions").fill("Provide proof of coverage.");
  await page.getByRole("button", { name: "Complete review" }).click();
  await page.getByLabel("Viewing as").selectOption("Requester");
  await page.getByLabel("Prototype Requester profile").fill("alice@example.test");
  await expect(page.getByRole("region", { name: "Submission details" })).toContainText("Provide proof of coverage.");
  await expect(page.locator("body")).not.toContainText("PRIVATE INTERNAL STRATEGY");
  await page.getByLabel("Submit a revised agreement").setInputFiles({ name: "new.txt", mimeType: "text/plain", buffer: Buffer.from("Governed by the laws of Georgia.") });
  await expect(page.getByRole("status")).toContainText("New version submitted");
  await expect(page.getByRole("table")).toContainText("Version 3");
  await expect(page.locator("body")).not.toContainText("Provide proof of coverage.");
  await expect(page.getByRole("region", { name: "Submission details" })).toContainText("Review not completed");
});
