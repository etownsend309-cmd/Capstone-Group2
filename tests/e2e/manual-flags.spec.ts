/**
 * Manual flags (pull request #7) in a real browser, saved through the API.
 * The agreements are someone else's: nobody reviews their own submission.
 */

import { expect, requester, test } from "./support/session";

const contractText =
  "Section 4. Governing law is the law of New York. Section 9. Either party may terminate on notice.";

test("creates and edits an audited manual provision flag with required fields", async ({ page, server }) => {
  const agreement = server.addAgreement({ name: "Northstar agreement", rawText: contractText });
  await page.goto("/");
  await expect(page.getByText(requester.email)).toBeVisible();
  await page.getByRole("navigation").getByRole("button", { name: /Review queue/ }).click();
  await page.getByRole("button", { name: /Add manual flag/ }).click();

  await page.getByRole("button", { name: "Create flag" }).click();
  await expect(page.getByLabel("Exact supporting source text")).toHaveAttribute("aria-invalid", "true");
  expect(server.agreements()[0]!.findings.filter((f) => f.method === "manual")).toEqual([]);

  await expect(page.getByLabel("Creator")).toHaveValue(requester.email);
  await page.getByLabel("Playbook category").selectOption("Governing Law");
  await page.getByLabel("Severity").selectOption("High");
  await page.getByLabel("Exact supporting source text").fill("Governing law is the law of New York.");
  await page.getByLabel("Reason").fill("The selected law needs legal review.");
  await page.getByRole("button", { name: "Create flag" }).click();
  await expect(page.getByText("Manual origin")).toBeVisible();
  await expect(page.locator(".source-card blockquote")).toHaveText("Governing law is the law of New York.");
  await expect(page.getByText("Audit history (1)")).toBeVisible();

  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "Edit manual flag" }).click();
  await page.getByLabel("Reason").fill("Updated after accepting the finding.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Audit history (3)")).toBeVisible();

  const saved = server.agreements().find((a) => a.id === agreement.id)!.findings.find((f) => f.method === "manual")!;
  expect(saved).toMatchObject({
    category: "Governing Law",
    findingType: "provision",
    severity: "high",
    reason: "Updated after accepting the finding.",
    sourceText: "Governing law is the law of New York.",
    createdBy: { email: requester.email },
    method: "manual",
    decision: "accepted",
  });
  expect(saved.history.map((entry) => entry.action)).toEqual(["created", "decision", "edited"]);
  expect(saved.history[2]!.before!.decision).toBe("accepted");
});

test("creates a gap flag without contract evidence", async ({ page, server }) => {
  const agreement = server.addAgreement({ name: "Northstar agreement", rawText: contractText });
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: /Review queue/ }).click();
  await page.getByRole("button", { name: /Add manual flag/ }).click();
  await page.getByLabel("Finding type").selectOption("Gap");
  await page.getByLabel("Applicable playbook expectation").fill("The agreement should identify the governing law.");
  await page.getByLabel("Reason").fill("No governing-law expectation is satisfied in the provided agreement.");
  await page.getByRole("button", { name: "Create flag" }).click();

  await expect(page.getByText("No contract text cited for this gap.")).toBeVisible();
  await expect(page.getByText("The agreement should identify the governing law.")).toBeVisible();
  const saved = server.agreements().find((a) => a.id === agreement.id)!.findings.find((f) => f.method === "manual")!;
  expect(saved.findingType).toBe("gap");
  expect(saved.sourceText).toBe("");
  expect(saved.playbookExpectation).toBe("The agreement should identify the governing law.");
});
