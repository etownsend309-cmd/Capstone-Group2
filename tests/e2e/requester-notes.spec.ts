import { expect, test } from "@playwright/test";

test("requester cannot read internal notes, including after switching roles", async ({ page }) => {
  const internalNote = "Internal legal negotiation strategy: do not disclose.";
  const agreement = {
    id: "privacy-fixture", name: "Privacy test agreement", vendor: "Synthetic vendor",
    agreementType: "Services", businessUnit: "Test", neededBy: "2026-12-01",
    submittedAt: "2026-10-01T12:00:00Z", submittedBy: "Prototype user",
    status: "Approved", rawText: "Governing law: Georgia.",
    findings: [
      { id: "internal", category: "Governing Law", confidence: 0.98,
        sourceText: "Governing law: Georgia.", decision: "accepted",
        note: internalNote, method: "Local rule" },
      { id: "manual", category: "Audit Rights", confidence: 1,
        sourceText: "Synthetic audit clause", decision: "accepted",
        note: "Added manually by reviewer.", method: "Manual" },
    ],
  };
  await page.addInitScript((record) => {
    localStorage.setItem("clausepilot-agreements-v1", JSON.stringify([record]));
  }, agreement);
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("button", { name: /Review queue/ }).click();
  await expect(page.getByLabel("Reviewer note")).toHaveValue(internalNote);
  await page.getByRole("button", { name: /Audit Rights/ }).click();
  await page.getByLabel("Viewing as").selectOption("Requester");
  await expect(page.getByLabel("Reviewer note")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Complete review" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(internalNote);
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "My submissions" })).toBeVisible();
  await expect(page.getByLabel("Reviewer note")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Added manually by reviewer.");
  await page.getByLabel("Viewing as").selectOption("Reviewer");
  await page.getByRole("button", { name: /Audit Rights/ }).click();
  await expect(page.getByLabel("Reviewer note")).toHaveValue("Added manually by reviewer.");
});
