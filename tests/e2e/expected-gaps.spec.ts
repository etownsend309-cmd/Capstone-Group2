import { expect, requester, test } from "./support/session";

const STORAGE_KEY = "clausepilot-agreements-v1";

test("detects expected-provision gaps and supports reasoned dismiss and escalation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(requester.email)).toBeVisible();
  await page.getByRole("navigation").getByRole("button", { name: "New agreement" }).click();
  await page.getByLabel("Agreement document", { exact: true }).setInputFiles({
    name: "services-agreement.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Services begin on the effective date and continue until the work is complete."),
  });
  await page.getByLabel("Vendor").fill("Northstar Data");
  await page.getByLabel("Agreement type").fill("Master services agreement");
  await page.getByLabel("Business unit").fill("Legal");
  await page.getByLabel("Needed-by date").fill("2026-12-01");
  await page.getByRole("button", { name: /Create review/ }).click();
  await expect(page.getByRole("heading", { name: "My submissions" })).toBeVisible();

  await page.evaluate((key) => {
    const agreements = JSON.parse(localStorage.getItem(key) ?? "[]");
    agreements[0].submittedBy = "different-requester@example.test";
    localStorage.setItem(key, JSON.stringify(agreements));
  }, STORAGE_KEY);
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: /Review queue/ }).click();

  await page.getByRole("button", { name: /Governing Law/ }).click();
  await expect(page.getByText("No contract text cited for this gap.")).toBeVisible();
  await expect(page.getByText("Search performed")).toBeVisible();
  await expect(page.getByText("The complete stored agreement text was searched; no matching provision was identified.")).toBeVisible();
  await expect(page.getByText("The agreement identifies its governing law and jurisdiction.")).toBeVisible();
  const gap = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]")[0].findings.find((finding: { category: string }) => finding.category === "Governing Law"), STORAGE_KEY);
  expect(gap).toMatchObject({ findingType: "Gap", sourceText: "" });

  await page.getByLabel("Reviewer note").fill("Dismissed after reviewing the completed text search.");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.getByRole("button", { name: /Audit Rights/ }).click();
  await page.getByLabel("Reviewer note").fill("Escalate for counsel to confirm whether audit rights are required.");
  await page.getByRole("button", { name: "Escalate" }).click();

  const decisions = await page.evaluate((key) => {
    const findings = JSON.parse(localStorage.getItem(key) ?? "[]")[0].findings;
    return Object.fromEntries(findings.map((finding: { category: string; decision: string; note: string; sourceText: string }) => [
      finding.category,
      { decision: finding.decision, note: finding.note, sourceText: finding.sourceText },
    ]));
  }, STORAGE_KEY);
  expect(decisions["Governing Law"]).toMatchObject({ decision: "dismissed", sourceText: "" });
  expect(decisions["Governing Law"].note).toContain("completed text search");
  expect(decisions["Audit Rights"]).toMatchObject({ decision: "escalated", sourceText: "" });
  expect(decisions["Audit Rights"].note).toContain("counsel");
});