import path from "node:path";
import { type Page } from "@playwright/test";

// Starts signed in: the intake flow is behind the identity gate, and these
// tests are about submission, not about authentication.
import { expect, requester, test } from "./support/session";

const fields = [
  ["Vendor", "Northstar Data", "Enter a vendor."],
  ["Agreement type", "Master services agreement", "Enter an agreement type."],
  ["Business unit", "Shared services", "Enter a business unit."],
  ["Needed-by date", "2026-12-01", "Enter a needed-by date."],
] as const;
const fixture = (name: string) => path.resolve("fixtures/generated", name);
async function openIntake(page: Page) {
  await page.goto("/");
  // Asserted rather than assumed: if the seeded session stopped satisfying the
  // gate, every test below would otherwise fail on a missing control with no
  // hint that the sign-in card is what rendered.
  await expect(page.getByText(requester.email)).toBeVisible();
  await page.getByLabel("Viewing as").selectOption("Requester");
  await page.getByRole("navigation").getByRole("button", { name: "New agreement" }).click();
}
async function fillMetadata(page: Page, except?: string) {
  for (const [label, value] of fields) if (label !== except) await page.getByLabel(label).fill(value);
}

test("valid PDF submission appears in the requester tracker and survives reload", async ({ page }) => {
  await openIntake(page);
  await page.getByLabel("Agreement document", { exact: true }).setInputFiles(fixture("clean-agreement.pdf"));
  await fillMetadata(page);
  await page.getByRole("button", { name: /Create review/ }).click();
  await expect(page.getByRole("status")).toContainText("submitted successfully");
  await expect(page.getByRole("heading", { name: "My submissions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "clean-agreement.pdf" })).toBeVisible();
  for (const [, value] of fields) await expect(page.locator(".tracker-record")).toContainText(value);
  await expect(page.locator(".tracker-record")).toContainText("Needs review");
  await page.reload();
  await page.getByRole("button", { name: "My submissions" }).click();
  await expect(page.getByRole("heading", { name: "clean-agreement.pdf" })).toBeVisible();
});

test("validated AI findings flow from intake into human review", async ({ page }) => {
  await page.route("**/.netlify/functions/classify-agreement", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "complete",
        run: {
          id: "524d8fcc-8858-4285-a41c-69516c4dd2ca",
          provider: "OpenAI",
          requestedModel: "gpt-5.6-terra",
          returnedModel: "gpt-5.6-terra",
          providerResponseId: "resp_browser_test",
          promptVersion: "clausepilot-classifier-v1",
          schemaVersion: "classifier-output-v1",
          modelConfigVersion: "openai-terra-low-v1",
          startedAt: "2026-11-02T20:00:00.000Z",
          completedAt: "2026-11-02T20:00:01.000Z",
          latencyMs: 1000,
          status: "complete",
        },
        findings: [{
          category: "Governing Law",
          sourceText: "governed by the laws of the State of Ohio",
          sourceStart: 2350,
          sourceEnd: 2393,
          confidenceIndicator: "high",
          evidenceValidation: "exact",
        }],
        rejections: [],
      }),
    });
  });
  await openIntake(page);
  await page.getByLabel("Agreement document", { exact: true }).setInputFiles(fixture("clean-agreement.pdf"));
  await fillMetadata(page);
  await page.getByRole("button", { name: /Create review/ }).click();
  await page.getByRole("button", { name: /Review queue/ }).click();

  await expect(page.getByText("High model confidence · not calibrated").first()).toBeVisible();
  await expect(page.getByText("governed by the laws of the State of Ohio")).toBeVisible();
  await expect(page.getByText(/Every displayed quote passed exact source validation/)).toBeVisible();
});

for (const [label, , message] of fields) {
  test(`required ${label} has accessible validation`, async ({ page }) => {
    await openIntake(page);
    await page.getByLabel("Agreement document", { exact: true }).setInputFiles(fixture("clean-agreement.pdf"));
    await fillMetadata(page, label);
    await page.getByRole("button", { name: /Create review/ }).click();
    await expect(page.getByLabel(label)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel(label)).toHaveAccessibleDescription(message);
    await expect(page.getByLabel(label)).toBeFocused();
    await expect(page.getByRole("alert")).toContainText("Submission not completed");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("clausepilot-agreements-v1") ?? "[]"))).toEqual([]);
  });
}

test("document is required", async ({ page }) => {
  await openIntake(page);
  await fillMetadata(page);
  await page.getByRole("button", { name: /Create review/ }).click();
  const upload = page.getByRole("button", { name: /Drop an agreement/ });
  await expect(upload).toBeFocused();
  await expect(upload).toHaveAccessibleDescription("Choose a PDF or text document.");
});

test("upload and submission work using the keyboard", async ({ page }) => {
  await openIntake(page);
  const upload = page.getByRole("button", { name: /Drop an agreement/ });
  await upload.focus();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(fixture("clean-agreement.pdf"));
  await page.getByRole("button", { name: /Replace agreement document/ }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Agreement title")).toBeFocused();
  await page.keyboard.press("Tab");
  for (const [label, value] of fields) {
    await expect(page.getByLabel(label)).toBeFocused();
    await page.getByLabel(label).fill(value);
    await page.keyboard.press("Tab");
    // Native date inputs expose several keyboard stops (month/day/year/calendar).
    if (label === "Needed-by date") {
      for (let stop = 0; stop < 5 && await page.getByLabel(label).evaluate((input) => input === document.activeElement); stop++) await page.keyboard.press("Tab");
    }
  }
  await expect(page.getByRole("button", { name: "Load demo agreement" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Create review/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("submitted successfully");
});

test("unreadable PDF gives a failure result without a record", async ({ page }) => {
  await openIntake(page);
  await page.getByLabel("Agreement document", { exact: true }).setInputFiles(fixture("scanned-agreement.pdf"));
  await fillMetadata(page);
  await page.getByRole("button", { name: /Create review/ }).click();
  await expect(page.getByRole("alert")).toContainText(/scanned|image-only/i);
  await expect(page.getByLabel("Vendor")).toHaveValue("Northstar Data");
  // The status region stays mounted so it can be announced; it must be empty.
  await expect(page.getByRole("status")).toHaveText("");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("clausepilot-agreements-v1") ?? "[]"))).toEqual([]);
});

test("browser storage failure never reports success", async ({ page }) => {
  await openIntake(page);
  await page.getByLabel("Agreement document", { exact: true }).setInputFiles(fixture("clean-agreement.pdf"));
  await fillMetadata(page);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); }; });
  await page.getByRole("button", { name: /Create review/ }).click();
  await expect(page.getByRole("alert")).toContainText("Your submission was not saved");
  await expect(page.getByRole("status")).toHaveText("");
  await page.getByRole("button", { name: "My submissions" }).click();
  await expect(page.getByRole("heading", { name: "No submissions yet" })).toBeVisible();
});
