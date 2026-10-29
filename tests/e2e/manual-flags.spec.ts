import { expect, requester, test } from "./support/session";

const STORAGE_KEY = "clausepilot-agreements-v1";
const contractText =
  "Section 4. Governing law is the law of New York. Section 9. Either party may terminate on notice.";

test("creates and edits an audited manual provision flag with required fields", async ({
  page,
}) => {
  await page.addInitScript(
    ([key, agreement]) =>
      window.localStorage.setItem(key, JSON.stringify([agreement])),
    [
      STORAGE_KEY,
      {
        id: "manual-flag-e2e",
        name: "Northstar agreement",
        vendor: "Northstar",
        agreementType: "MSA",
        businessUnit: "Legal",
        neededBy: "2026-12-01",
        submittedAt: "2026-10-01T10:00:00:00Z",
        submittedBy: requester.email,
        status: "Needs review",
        rawText: contractText,
        findings: [],
      },
    ] as const,
  );
  await page.goto("/");
  await expect(page.getByText(requester.email)).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /Review queue/ })
    .click();
  await page.getByRole("button", { name: /Add manual flag/ }).click();

  await page.getByRole("button", { name: "Create flag" }).click();
  await expect(page.getByLabel("Exact supporting source text")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "[]")[0].findings,
      STORAGE_KEY,
    ),
  ).toEqual([]);

  await page.getByLabel("Playbook category").selectOption("Governing Law");
  await page.getByLabel("Severity").selectOption("High");
  await page
    .getByLabel("Exact supporting source text")
    .fill("Governing law is the law of New York.");
  await page.getByLabel("Reason").fill("The selected law needs legal review.");
  await page.getByRole("button", { name: "Create flag" }).click();
  await expect(page.getByText("Manual origin")).toBeVisible();
  await expect(
    page.getByText("Governing law is the law of New York."),
  ).toBeVisible();
  await expect(page.getByText("Audit history (1)")).toBeVisible();

  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "Edit manual flag" }).click();
  await page.getByLabel("Reason").fill("Updated after accepting the finding.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Audit history (3)")).toBeVisible();



  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]")[0].findings[0], STORAGE_KEY);
  expect(saved).toMatchObject({
    category: "Governing Law",
    findingType: "Provision",
    severity: "High",
    reason: "Updated after accepting the finding.",
    sourceText: "Governing law is the law of New York.",
    creator: requester.email,
    method: "Manual",
    decision: "accepted",
  });
  expect(saved.history.map((entry: { action: string }) => entry.action)).toEqual(["created", "decision", "edited"]);
  expect(saved.history[2].before.decision).toBe("accepted");
});

test("creates a gap flag without contract evidence", async ({ page }) => {
  await page.addInitScript(
    ([key, agreement]) =>
      window.localStorage.setItem(key, JSON.stringify([agreement])),
    [
      STORAGE_KEY,
      {
        id: "manual-gap-e2e",
        name: "Northstar agreement",
        vendor: "Northstar",
        agreementType: "MSA",
        businessUnit: "Legal",
        neededBy: "2026-12-01",
        submittedAt: "2026-10-01T10:00:00.000Z",
        submittedBy: requester.email,
        status: "Needs review",
        rawText: contractText,
        findings: [],
      },
    ] as const,
  );
  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: /Review queue/ }).click();
  await page.getByRole("button", { name: /Add manual flag/ }).click();
  await page.getByLabel("Finding type").selectOption("Gap");
  await page.getByLabel("Applicable playbook expectation").fill("The agreement should identify the governing law.");
  await page.getByLabel("Reason").fill("No governing-law expectation is satisfied in the provided agreement.");
  await page.getByRole("button", { name: "Create flag" }).click();

  await expect(page.getByText("No contract text cited for this gap.")).toBeVisible();
  await expect(page.getByText("The agreement should identify the governing law.")).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]")[0].findings[0], STORAGE_KEY);
  expect(saved.findingType).toBe("Gap");
  expect(saved.sourceText).toBe("");
  expect(saved.playbookExpectation).toBe("The agreement should identify the governing law.");
});