/**
 * End-to-end checks of the temporary evaluation UI.
 *
 * These use only the generated fixtures in fixtures/generated. Never point a
 * test at fixtures/private.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/generated",
);

const fixture = (name: string) => path.join(FIXTURES, name);

/**
 * The harness is no longer the default view: `/` serves the agreement review
 * app, and the harness is mounted behind this query string by src/main.tsx.
 */
const HARNESS_URL = "/?view=extraction-poc";

/** Upload a fixture, label it, and run the extraction. */
async function runFixture(page: Page, file: string, category: string) {
  await page.goto(HARNESS_URL);
  await page.getByTestId("file-input").setInputFiles(fixture(file));
  await expect(page.getByTestId("file-summary")).toBeVisible();
  await page.getByTestId(`category-${category}`).check();
  await page.getByTestId("run-extraction").click();
  await expect(page.getByTestId("overall-status")).toBeVisible({ timeout: 30_000 });
}

test.describe("clean PDF", () => {
  test("extracts text and reports success", async ({ page }) => {
    await runFixture(page, "clean-agreement.pdf", "clean");

    await expect(page.getByTestId("overall-status")).toHaveText("Success");
    await expect(page.getByTestId("summary-pages")).toHaveText("2");
    await expect(page.getByTestId("summary-empty")).toHaveText("0");
    await expect(page.getByTestId("summary-fallback")).toHaveText("Not needed");

    // Both strategies must report a real character count.
    for (const strategy of ["content-order", "coordinate-order"]) {
      await expect(page.getByTestId(`status-${strategy}`)).toHaveText("Success");
      const printable = await page.getByTestId(`printable-${strategy}`).innerText();
      expect(Number(printable.replace(/,/g, ""))).toBeGreaterThan(1000);
    }

    // The extracted text is inspectable.
    await page.getByTestId("text-details-content-order").locator("summary").click();
    await expect(page.getByTestId("text-content-order")).toContainText(
      "MASTER SERVICES AGREEMENT",
    );

    // No fallback panel for a healthy document.
    await expect(page.getByTestId("fallback-panel")).toHaveCount(0);
  });

  test("shows the file name and size before running", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.getByTestId("file-input").setInputFiles(fixture("clean-agreement.pdf"));
    await expect(page.getByTestId("file-name")).toHaveText("clean-agreement.pdf");
    await expect(page.getByTestId("file-size")).toContainText("KB");
  });

  test("reset clears the results", async ({ page }) => {
    await runFixture(page, "clean-agreement.pdf", "clean");
    await page.getByTestId("reset-all").click();
    await expect(page.getByTestId("overall-status")).toHaveCount(0);
    await expect(page.getByTestId("dropzone")).toBeVisible();
  });
});

test.describe("multi-column PDF", () => {
  test("lets the two strategies be compared side by side", async ({ page }) => {
    await runFixture(page, "multicolumn-agreement.pdf", "difficult");

    await expect(page.getByTestId("overall-status")).toHaveText("Success");

    const contentChars = Number(
      (await page.getByTestId("printable-content-order").innerText()).replace(/,/g, ""),
    );
    const coordinateChars = Number(
      (await page.getByTestId("printable-coordinate-order").innerText()).replace(/,/g, ""),
    );

    // Identical volume: this is exactly why character count cannot rank them.
    expect(contentChars).toBe(coordinateChars);
    expect(contentChars).toBeGreaterThan(500);

    await page.getByTestId("left-pane-select").selectOption("content-order");
    await page.getByTestId("right-pane-select").selectOption("coordinate-order");

    const left = await page.getByTestId("pane-left").innerText();
    const right = await page.getByTestId("pane-right").innerText();

    // Stream order interleaves the columns onto one line.
    expect(left).toContain("A. DEFINITIONS B. SERVICE LEVELS");
    // Coordinate order keeps each column whole.
    expect(right).not.toContain("A. DEFINITIONS B. SERVICE LEVELS");
    expect(right.indexOf("Service Window")).toBeLessThan(right.indexOf("B. SERVICE LEVELS"));
  });

  test("states that both strategies are PDF.js, not separate engines", async ({ page }) => {
    await runFixture(page, "multicolumn-agreement.pdf", "difficult");
    await expect(page.getByText(/not two independent PDF engines/i)).toBeVisible();
  });
});

test.describe("scanned PDF", () => {
  test("fails explicitly and explains that PDF.js cannot OCR", async ({ page }) => {
    await runFixture(page, "scanned-agreement.pdf", "scanned");

    await expect(page.getByTestId("overall-status")).toHaveText("Failed");
    await expect(page.getByTestId("summary-chars")).toHaveText("0");
    await expect(page.getByTestId("summary-empty")).toHaveText("1");
    await expect(page.getByTestId("summary-fallback")).toHaveText("Recommended");

    const reasons = page.getByTestId("run-reasons");
    await expect(reasons).toContainText("scanned-no-text-layer");
    await expect(reasons).toContainText("does not perform OCR");
    await expect(page.getByTestId("run-warnings")).toContainText("no text");

    for (const strategy of ["content-order", "coordinate-order"]) {
      await expect(page.getByTestId(`status-${strategy}`)).toHaveText("Failed");
      await expect(page.getByTestId(`no-text-${strategy}`)).toBeVisible();
    }
  });
});

test.describe("corrupt PDF", () => {
  test("fails visibly rather than looking like an empty success", async ({ page }) => {
    await runFixture(page, "corrupt-agreement.pdf", "unknown");
    await expect(page.getByTestId("overall-status")).toHaveText("Failed");
    await expect(page.getByTestId("summary-fallback")).toHaveText("Recommended");
    await expect(page.getByTestId("fallback-panel")).toBeVisible();
  });
});

test.describe("plaintext fallback", () => {
  test("appears for an unusable extraction and names the reason", async ({ page }) => {
    await runFixture(page, "scanned-agreement.pdf", "scanned");

    const panel = page.getByTestId("fallback-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("fallback-reasons")).toContainText("scanned-no-text-layer");
    await expect(page.getByTestId("active-source-label")).toHaveText("PDF extraction (PDF.js)");
  });

  test("appears when a reviewer marks a healthy extraction unusable", async ({ page }) => {
    await runFixture(page, "clean-agreement.pdf", "clean");
    await expect(page.getByTestId("fallback-panel")).toHaveCount(0);

    await page.getByTestId("mark-unusable").check();

    await expect(page.getByTestId("fallback-panel")).toBeVisible();
    await expect(page.getByTestId("fallback-reasons")).toContainText("human-marked-unusable");
  });

  test("switches the source only after the tester confirms", async ({ page }) => {
    await runFixture(page, "scanned-agreement.pdf", "scanned");

    const supplied = "ADDENDUM ONE. Supplied by the vendor as plaintext for evaluation.";

    // Before confirming, the source must still say PDF extraction.
    await page.getByTestId("supplied-textarea").fill(supplied);
    await expect(page.getByTestId("active-source-label")).toHaveText("PDF extraction (PDF.js)");

    await page.getByTestId("confirm-supplied").click();

    await expect(page.getByTestId("active-source-label")).toHaveText(
      "Supplied plaintext (pasted)",
    );
    await expect(page.getByTestId("active-source")).toContainText("characters");
    await expect(page.getByTestId("visible-status")).toContainText("supplied plaintext");

    // And it can be reverted.
    await page.getByTestId("revert-source").click();
    await expect(page.getByTestId("active-source-label")).toHaveText("PDF extraction (PDF.js)");
  });

  test("refuses to confirm whitespace-only supplied text", async ({ page }) => {
    await runFixture(page, "scanned-agreement.pdf", "scanned");
    await page.getByTestId("supplied-textarea").fill("   \n\n   ");
    await expect(page.getByTestId("confirm-supplied")).toBeDisabled();
    await expect(page.getByTestId("supplied-counts")).toContainText("cannot be confirmed");
  });

  test("accepts a supplied .txt upload", async ({ page }) => {
    await runFixture(page, "scanned-agreement.pdf", "scanned");
    await page
      .getByTestId("txt-input")
      .setInputFiles(fixture("scanned-agreement.expected.txt"));
    await page.getByTestId("confirm-supplied").click();
    await expect(page.getByTestId("active-source-label")).toHaveText(
      "Supplied plaintext (uploaded)",
    );
  });
});

test.describe("invalid input", () => {
  test("rejects a non-PDF with a clear message", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.getByTestId("file-input").setInputFiles({
      name: "not-a-contract.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("This is a text file, not a PDF."),
    });

    const error = page.getByTestId("upload-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("not-a-contract.txt");
    await expect(error).toContainText("only accepts .pdf");
    await expect(page.getByTestId("file-summary")).toHaveCount(0);
  });

  test("rejects an empty .pdf", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.getByTestId("file-input").setInputFiles({
      name: "empty.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(0),
    });
    await expect(page.getByTestId("upload-error")).toContainText("empty");
  });

  test("explains that nothing can run without a file", async ({ page }) => {
    await page.goto(HARNESS_URL);
    await page.getByTestId("run-extraction").click();
    await expect(page.getByTestId("upload-error")).toContainText("Choose a PDF");
  });
});

test.describe("accessibility", () => {
  test("the whole upload flow is reachable and operable by keyboard", async ({ page }) => {
    await page.goto(HARNESS_URL);

    // The skip link is the first stop and points at the main landmark.
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();

    // Tab to the dropzone and open the picker with the keyboard.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("dropzone")).toBeFocused();

    // Category radios are reachable and operable with arrow keys.
    await page.getByTestId("category-clean").focus();
    await expect(page.getByTestId("category-clean")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("category-difficult")).toBeChecked();

    // The run button is reachable and activates with Enter.
    await page.getByTestId("file-input").setInputFiles(fixture("clean-agreement.pdf"));
    await page.getByTestId("run-extraction").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("overall-status")).toBeVisible({ timeout: 30_000 });
  });

  test("status messages are announced and visible", async ({ page }) => {
    await page.goto(HARNESS_URL);

    const live = page.getByTestId("status-message");
    await expect(live).toHaveAttribute("role", "status");
    await expect(live).toHaveAttribute("aria-live", "polite");

    await page.getByTestId("file-input").setInputFiles(fixture("clean-agreement.pdf"));
    await expect(page.getByTestId("visible-status")).toContainText("Ready to run");

    await page.getByTestId("run-extraction").click();
    await expect(page.getByTestId("visible-status")).toContainText("Extraction finished", {
      timeout: 30_000,
    });
  });

  test("every form control has an accessible name", async ({ page }) => {
    await runFixture(page, "clean-agreement.pdf", "clean");
    const unnamed = await page.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll("input, select, textarea, button"),
      ) as HTMLElement[];
      return controls
        .filter((element) => {
          const label = (
            element.getAttribute("aria-label") ??
            element.textContent ??
            ""
          ).trim();
          const id = element.getAttribute("id");
          const hasLabelElement = id
            ? Boolean(document.querySelector(`label[for="${CSS.escape(id)}"]`))
            : Boolean(element.closest("label"));
          return label.length === 0 && !hasLabelElement;
        })
        .map((element) => element.outerHTML.slice(0, 80));
    });
    expect(unnamed).toEqual([]);
  });
});

test.describe("report export", () => {
  test("excludes the extracted contract text by default", async ({ page }) => {
    await runFixture(page, "clean-agreement.pdf", "clean");

    await page.getByTestId("preferred-strategy").selectOption("coordinate-order");
    await page.getByTestId("preference-reason").fill("Kept reading order on the hard fixture.");

    const download = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-json").click(),
    ]).then(([event]) => event);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const contents = Buffer.concat(chunks).toString("utf8");
    const report = JSON.parse(contents);

    // Metrics are present...
    expect(report.library.name).toBe("pdfjs-dist");
    expect(report.strategies).toHaveLength(2);
    expect(report.strategies[0].printableCharacterCount).toBeGreaterThan(1000);
    expect(report.containsExtractedText).toBe(false);

    // ...but the contract text is not.
    expect(contents).not.toContain("MASTER SERVICES AGREEMENT");
    expect(contents).not.toContain("Northwind Analytics");
    expect(contents).not.toContain("Blue Harbor Logistics");
    for (const strategy of report.strategies) {
      expect(strategy.extractedTextExcerpt).toBeUndefined();
    }

    // The filename must not leak the document name either.
    expect(download.suggestedFilename()).not.toContain("clean-agreement");
    expect(download.suggestedFilename()).toMatch(/^pdf-extraction-report-clean-.*\.json$/);
  });

  test("includes only a truncated excerpt when the tester opts in", async ({ page }) => {
    await runFixture(page, "clean-agreement.pdf", "clean");
    await page.getByTestId("include-text-toggle").check();

    const download = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-json").click(),
    ]).then(([event]) => event);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    expect(report.containsExtractedText).toBe(true);
    expect(report.privacyNotice).toContain("WARNING");
    const excerpt: string = report.strategies[0].extractedTextExcerpt;
    expect(excerpt).toContain("MASTER SERVICES AGREEMENT");
    expect(excerpt).toContain("characters omitted");
    expect(excerpt.length).toBeLessThan(500);
  });

  test("exports Markdown without contract text by default", async ({ page }) => {
    await runFixture(page, "clean-agreement.pdf", "clean");

    const download = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("export-md").click(),
    ]).then(([event]) => event);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const contents = Buffer.concat(chunks).toString("utf8");

    expect(contents).toContain("# PDF extraction experiment report");
    expect(contents).toContain("pdfjs-dist");
    expect(contents).not.toContain("Northwind Analytics");
  });
});
