/**
 * @vitest-environment jsdom
 *
 * Component-level tests that drive the real extraction harness with the real generated
 * fixtures and the real PDF.js parse. Nothing is mocked except the browser
 * download plumbing, which jsdom does not implement.
 *
 * These cover the same behaviour as tests/e2e/extraction.spec.ts. Playwright
 * exercises it in a real browser; these run anywhere Node runs, so the UI is
 * still verified on machines that cannot install a Playwright browser.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PocApp from "../../src/poc/PocApp";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/generated");

/** Parsing on the main thread under jsdom is slower than in a browser. */
const PARSE_TIMEOUT = 30_000;

async function fixtureFile(name: string, type = "application/pdf"): Promise<File> {
  const bytes = await readFile(path.join(FIXTURES, name));
  return new File([bytes], name, { type });
}

/** Captures everything the page tries to hand to the browser as a download. */
interface CapturedDownload {
  filename: string;
  contents: string;
}

let downloads: CapturedDownload[] = [];

beforeEach(() => {
  downloads = [];
  const blobs = new Map<string, Blob>();

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (blob: Blob) => {
      const url = `blob:mock/${blobs.size}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL: () => {},
  });

  // jsdom does not navigate on anchor clicks, so record the intent instead.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href);
    if (!blob || !this.download) return;
    downloads.push({ filename: this.download, contents: "" });
    const index = downloads.length - 1;
    void blob.text().then((text) => {
      downloads[index].contents = text;
    });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Upload a fixture, label it, and run the extraction. */
async function runFixture(name: string, category: string) {
  const user = userEvent.setup();
  render(<PocApp />);

  await user.upload(screen.getByTestId("file-input"), await fixtureFile(name));
  await user.click(screen.getByTestId(`category-${category}`));
  await user.click(screen.getByTestId("run-extraction"));

  await waitFor(() => expect(screen.getByTestId("overall-status")).toBeTruthy(), {
    timeout: PARSE_TIMEOUT,
  });
  return user;
}

const text = (testId: string) => screen.getByTestId(testId).textContent?.trim() ?? "";
const count = (testId: string) => Number(text(testId).replace(/,/g, ""));

describe("clean PDF", () => {
  it(
    "extracts text and reports success",
    async () => {
      await runFixture("clean-agreement.pdf", "clean");

      expect(text("overall-status")).toBe("Success");
      expect(text("summary-pages")).toBe("2");
      expect(text("summary-empty")).toBe("0");
      expect(text("summary-fallback")).toBe("Not needed");

      for (const strategy of ["content-order", "coordinate-order"]) {
        expect(text(`status-${strategy}`)).toBe("Success");
        expect(count(`printable-${strategy}`)).toBeGreaterThan(1000);
      }

      expect(screen.getByTestId("text-content-order").textContent).toContain(
        "MASTER SERVICES AGREEMENT",
      );

      // A healthy document must not offer the fallback.
      expect(screen.queryByTestId("fallback-panel")).toBeNull();
    },
    PARSE_TIMEOUT,
  );

  it("shows the file name and size before running", async () => {
    const user = userEvent.setup();
    render(<PocApp />);
    await user.upload(screen.getByTestId("file-input"), await fixtureFile("clean-agreement.pdf"));

    expect(text("file-name")).toBe("clean-agreement.pdf");
    expect(text("file-size")).toContain("KB");
    expect(text("visible-status")).toContain("Ready to run");
  });

  it(
    "reset clears the results",
    async () => {
      const user = await runFixture("clean-agreement.pdf", "clean");
      await user.click(screen.getByTestId("reset-all"));

      expect(screen.queryByTestId("overall-status")).toBeNull();
      expect(screen.getByTestId("dropzone")).toBeTruthy();
    },
    PARSE_TIMEOUT,
  );
});

describe("multi-column PDF", () => {
  it(
    "shows both strategies so their reading order can be compared",
    async () => {
      await runFixture("multicolumn-agreement.pdf", "difficult");

      expect(text("overall-status")).toBe("Success");

      // Identical volume is exactly why character count cannot rank them.
      expect(count("printable-content-order")).toBe(count("printable-coordinate-order"));
      expect(count("printable-content-order")).toBeGreaterThan(500);

      const contentText = screen.getByTestId("text-content-order").textContent ?? "";
      const coordinateText = screen.getByTestId("text-coordinate-order").textContent ?? "";

      // Stream order interleaves the two columns onto single lines.
      expect(contentText).toContain("A. DEFINITIONS B. SERVICE LEVELS");
      // Coordinate order keeps each column whole.
      expect(coordinateText).not.toContain("A. DEFINITIONS B. SERVICE LEVELS");
      expect(coordinateText.indexOf("Service Window")).toBeLessThan(
        coordinateText.indexOf("B. SERVICE LEVELS"),
      );
    },
    PARSE_TIMEOUT,
  );

  it(
    "says the two strategies are not independent PDF engines",
    async () => {
      await runFixture("multicolumn-agreement.pdf", "difficult");
      expect(document.body.textContent).toContain("not two independent PDF engines");
    },
    PARSE_TIMEOUT,
  );
});

describe("scanned PDF", () => {
  it(
    "fails explicitly and explains that PDF.js cannot OCR",
    async () => {
      await runFixture("scanned-agreement.pdf", "scanned");

      expect(text("overall-status")).toBe("Failed");
      expect(text("summary-chars")).toBe("0");
      expect(text("summary-empty")).toBe("1");
      expect(text("summary-fallback")).toBe("Recommended");

      const reasons = text("run-reasons");
      expect(reasons).toContain("scanned-no-text-layer");
      expect(reasons).toContain("does not perform OCR");

      for (const strategy of ["content-order", "coordinate-order"]) {
        expect(text(`status-${strategy}`)).toBe("Failed");
        expect(screen.getByTestId(`no-text-${strategy}`)).toBeTruthy();
        // Nothing to copy or download when nothing was extracted.
        expect(screen.queryByTestId(`copy-${strategy}`)).toBeNull();
      }
    },
    PARSE_TIMEOUT,
  );
});

describe("corrupt PDF", () => {
  it(
    "fails visibly rather than looking like an empty success",
    async () => {
      await runFixture("corrupt-agreement.pdf", "unknown");

      expect(text("overall-status")).toBe("Failed");
      expect(text("summary-fallback")).toBe("Recommended");
      expect(screen.getByTestId("fallback-panel")).toBeTruthy();

      // A safe message, never a stack trace.
      expect(document.body.textContent).not.toContain("    at ");
      expect(document.body.textContent).not.toContain(".mjs:");
    },
    PARSE_TIMEOUT,
  );
});

describe("plaintext fallback", () => {
  it(
    "appears for an unusable extraction and names the reason",
    async () => {
      await runFixture("scanned-agreement.pdf", "scanned");

      expect(screen.getByTestId("fallback-panel")).toBeTruthy();
      expect(text("fallback-reasons")).toContain("scanned-no-text-layer");
      expect(text("active-source-label")).toBe("PDF extraction (PDF.js)");
    },
    PARSE_TIMEOUT,
  );

  it(
    "appears when a reviewer marks a healthy extraction unusable",
    async () => {
      const user = await runFixture("clean-agreement.pdf", "clean");
      expect(screen.queryByTestId("fallback-panel")).toBeNull();

      await user.click(screen.getByTestId("mark-unusable"));

      expect(screen.getByTestId("fallback-panel")).toBeTruthy();
      expect(text("fallback-reasons")).toContain("human-marked-unusable");
    },
    PARSE_TIMEOUT,
  );

  it(
    "switches the source only after the tester confirms, and never silently",
    async () => {
      const user = await runFixture("scanned-agreement.pdf", "scanned");

      await user.type(
        screen.getByTestId("supplied-textarea"),
        "ADDENDUM ONE. Supplied as plaintext for evaluation.",
      );

      // Typing alone must not change the source.
      expect(text("active-source-label")).toBe("PDF extraction (PDF.js)");

      await user.click(screen.getByTestId("confirm-supplied"));

      expect(text("active-source-label")).toBe("Supplied plaintext (pasted)");
      expect(text("visible-status")).toContain("supplied plaintext");

      await user.click(screen.getByTestId("revert-source"));
      expect(text("active-source-label")).toBe("PDF extraction (PDF.js)");
    },
    PARSE_TIMEOUT,
  );

  it(
    "refuses to confirm whitespace-only supplied text",
    async () => {
      const user = await runFixture("scanned-agreement.pdf", "scanned");

      await user.type(screen.getByTestId("supplied-textarea"), "    ");

      expect(screen.getByTestId<HTMLButtonElement>("confirm-supplied").disabled).toBe(true);
      expect(text("supplied-counts")).toContain("cannot be confirmed");
      expect(text("active-source-label")).toBe("PDF extraction (PDF.js)");
    },
    PARSE_TIMEOUT,
  );

  it(
    "accepts supplied plaintext from a .txt upload",
    async () => {
      const user = await runFixture("scanned-agreement.pdf", "scanned");

      await user.upload(
        screen.getByTestId("txt-input"),
        await fixtureFile("scanned-agreement.expected.txt", "text/plain"),
      );
      await waitFor(() => expect(text("supplied-counts")).toContain("(uploaded)"));
      await user.click(screen.getByTestId("confirm-supplied"));

      expect(text("active-source-label")).toBe("Supplied plaintext (uploaded)");
    },
    PARSE_TIMEOUT,
  );

  it(
    "rejects a non-.txt file as supplied plaintext",
    async () => {
      await runFixture("scanned-agreement.pdf", "scanned");

      // applyAccept:false because the `accept` attribute is only a picker hint;
      // drag-and-drop and "All files" get past it, so validation must too.
      await userEvent.setup({ applyAccept: false }).upload(
        screen.getByTestId("txt-input"),
        new File(["%PDF-1.7"], "another.pdf", { type: "application/pdf" }),
      );

      await waitFor(() => expect(text("txt-upload-error")).toContain("not a .txt file"));
      expect(text("active-source-label")).toBe("PDF extraction (PDF.js)");
    },
    PARSE_TIMEOUT,
  );
});

describe("invalid input", () => {
  it("rejects a non-PDF with a clear message", async () => {
    // applyAccept:false because the `accept` attribute is only a picker hint;
    // drag-and-drop and "All files" get past it, so validation must too.
    const user = userEvent.setup({ applyAccept: false });
    render(<PocApp />);

    await user.upload(
      screen.getByTestId("file-input"),
      new File(["not a pdf"], "not-a-contract.txt", { type: "text/plain" }),
    );

    expect(text("upload-error")).toContain("not-a-contract.txt");
    expect(text("upload-error")).toContain("only accepts .pdf");
    expect(screen.queryByTestId("file-summary")).toBeNull();
  });

  it("explains that nothing can run without a file", async () => {
    const user = userEvent.setup();
    render(<PocApp />);

    await user.click(screen.getByTestId("run-extraction"));

    expect(text("upload-error")).toContain("Choose a PDF");
    expect(screen.queryByTestId("overall-status")).toBeNull();
  });
});

describe("accessibility", () => {
  it("announces status changes in a live region", async () => {
    const user = userEvent.setup();
    render(<PocApp />);

    const live = screen.getByTestId("status-message");
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");

    await user.upload(screen.getByTestId("file-input"), await fixtureFile("clean-agreement.pdf"));
    expect(live.textContent).toContain("Ready to run");
  });

  it(
    "gives every form control an accessible name",
    async () => {
      await runFixture("clean-agreement.pdf", "clean");

      const unnamed = Array.from(
        document.querySelectorAll<HTMLElement>("input, select, textarea, button"),
      ).filter((element) => {
        const label = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
        const id = element.getAttribute("id");
        const labelled = id
          ? Boolean(document.querySelector(`label[for="${CSS.escape(id)}"]`))
          : Boolean(element.closest("label"));
        return label.length === 0 && !labelled;
      });

      expect(unnamed.map((element) => element.outerHTML.slice(0, 80))).toEqual([]);
    },
    PARSE_TIMEOUT,
  );

  it(
    "reaches the run button by keyboard and activates it with Enter",
    async () => {
      const user = userEvent.setup();
      render(<PocApp />);
      await user.upload(screen.getByTestId("file-input"), await fixtureFile("clean-agreement.pdf"));

      screen.getByTestId("run-extraction").focus();
      expect(document.activeElement).toBe(screen.getByTestId("run-extraction"));

      await user.keyboard("{Enter}");
      await waitFor(() => expect(screen.getByTestId("overall-status")).toBeTruthy(), {
        timeout: PARSE_TIMEOUT,
      });
    },
    PARSE_TIMEOUT,
  );
});

describe("report export", () => {
  it(
    "excludes the extracted contract text by default",
    async () => {
      const user = await runFixture("clean-agreement.pdf", "clean");

      await user.selectOptions(screen.getByTestId("preferred-strategy"), "coordinate-order");
      await user.type(screen.getByTestId("preference-reason"), "Kept the reading order.");
      await user.click(screen.getByTestId("export-json"));

      await waitFor(() => expect(downloads[0]?.contents.length ?? 0).toBeGreaterThan(0));
      const { filename, contents } = downloads[0];
      const report = JSON.parse(contents);

      // The metrics are there...
      expect(report.library.name).toBe("pdfjs-dist");
      expect(report.strategies).toHaveLength(2);
      expect(report.strategies[0].printableCharacterCount).toBeGreaterThan(1000);
      expect(report.containsExtractedText).toBe(false);
      expect(report.preference.strategy).toBe("coordinate-order");

      // ...but the contract text is not.
      expect(contents).not.toContain("MASTER SERVICES AGREEMENT");
      expect(contents).not.toContain("Northwind Analytics");
      expect(contents).not.toContain("Blue Harbor Logistics");
      for (const strategy of report.strategies) {
        expect(strategy.extractedTextExcerpt).toBeUndefined();
      }

      // And the filename does not leak the document name.
      expect(filename).not.toContain("clean-agreement");
      expect(filename).toMatch(/^pdf-extraction-report-clean-.*\.json$/);
    },
    PARSE_TIMEOUT,
  );

  it(
    "includes only a truncated excerpt when the tester opts in",
    async () => {
      const user = await runFixture("clean-agreement.pdf", "clean");

      await user.click(screen.getByTestId("include-text-toggle"));
      await user.click(screen.getByTestId("export-json"));

      await waitFor(() => expect(downloads[0]?.contents.length ?? 0).toBeGreaterThan(0));
      const report = JSON.parse(downloads[0].contents);

      expect(report.containsExtractedText).toBe(true);
      expect(report.privacyNotice).toContain("WARNING");

      const excerpt: string = report.strategies[0].extractedTextExcerpt;
      expect(excerpt).toContain("MASTER SERVICES AGREEMENT");
      expect(excerpt).toContain("characters omitted");
      expect(excerpt.length).toBeLessThan(500);
    },
    PARSE_TIMEOUT,
  );

  it(
    "exports Markdown without contract text by default",
    async () => {
      const user = await runFixture("clean-agreement.pdf", "clean");

      await user.click(screen.getByTestId("export-md"));

      await waitFor(() => expect(downloads[0]?.contents.length ?? 0).toBeGreaterThan(0));
      const { filename, contents } = downloads[0];

      expect(filename).toMatch(/\.md$/);
      expect(contents).toContain("# PDF extraction experiment report");
      expect(contents).toContain("pdfjs-dist");
      expect(contents).not.toContain("Northwind Analytics");
    },
    PARSE_TIMEOUT,
  );

  it(
    "previews exactly what was downloaded",
    async () => {
      const user = await runFixture("clean-agreement.pdf", "clean");

      await user.click(screen.getByTestId("export-md"));
      await waitFor(() => expect(downloads[0]?.contents.length ?? 0).toBeGreaterThan(0));

      const preview = within(screen.getByTestId("report-preview")).queryAllByText(
        /PDF extraction experiment report/,
      );
      expect(preview.length).toBeGreaterThan(0);
      expect(screen.getByTestId("report-preview").textContent).toBe(downloads[0].contents);
    },
    PARSE_TIMEOUT,
  );
});
