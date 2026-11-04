import { expect, test } from "./support/session";

test("reviews server-backed expected-provision gaps with reasoned decisions", async ({ page, server }) => {
  const agreement = server.addAgreement({
    name: "Services agreement",
    vendor: "Northstar Data",
    rawText: "Services begin on the effective date and continue until the work is complete.",
  });

  await page.goto("/");
  await page.getByRole("navigation").getByRole("button", { name: /Review queue/ }).click();

  await page.getByRole("button", { name: /Governing Law/ }).click();
  await expect(page.getByText("No contract text cited for this gap.")).toBeVisible();
  await expect(page.getByText("Search performed")).toBeVisible();
  await expect(page.getByText("The complete stored agreement text was searched; no matching provision was identified.")).toBeVisible();
  await expect(page.getByText("The agreement identifies its governing law and jurisdiction.")).toBeVisible();
  expect(server.agreements()[0]!.findings.find((finding) => finding.category === "Governing Law")).toMatchObject({
    findingType: "gap",
    classification: "gap",
    sourceText: "",
  });

  await page.getByLabel("Reviewer note").fill("Dismissed after reviewing the completed text search.");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.getByRole("button", { name: /Audit Rights/ }).click();
  await page.getByLabel("Reviewer note").fill("Escalate for counsel to confirm whether audit rights are required.");
  await page.getByRole("button", { name: "Escalate" }).click();

  const saved = server.agreements().find((item) => item.id === agreement.id)!;
  const decisions = Object.fromEntries(saved.findings.map((finding) => [finding.category, finding]));
  expect(decisions["Governing Law"]).toMatchObject({ decision: "dismissed", sourceText: "" });
  expect(decisions["Governing Law"]!.note).toContain("completed text search");
  expect(decisions["Audit Rights"]).toMatchObject({ decision: "escalated", sourceText: "" });
  expect(decisions["Audit Rights"]!.note).toContain("counsel");
});