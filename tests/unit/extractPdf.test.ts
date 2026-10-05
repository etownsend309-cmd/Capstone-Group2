/**
 * End-to-end checks of the PDF.js driver against the generated fixtures.
 *
 * These run in Node against the same `legacy` PDF.js build the browser app
 * uses, so they exercise the real parse path rather than a mock. They use only
 * generated fixtures; nothing from fixtures/private is ever read here.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { classifyError, describeError, extractPdf } from "../../src/pdf/extractPdf";
import { compareToGroundTruth } from "../../src/pdf/similarity";
import type { ExtractionRun } from "../../src/pdf/types";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/generated",
);

async function loadFixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES, `${name}.pdf`)));
}

async function loadExpected(name: string): Promise<string> {
  return readFile(path.join(FIXTURES, `${name}.expected.txt`), "utf8");
}

describe("clean single-column fixture", () => {
  let run: ExtractionRun;
  beforeAll(async () => {
    run = await extractPdf(await loadFixture("clean-agreement"), {
      fileName: "clean-agreement.pdf",
    });
  });

  it("succeeds", () => {
    expect(run.status).toBe("success");
    expect(run.error).toBeNull();
    expect(run.looksScanned).toBe(false);
  });

  it("preserves page boundaries", () => {
    expect(run.pageCount).toBe(2);
    for (const strategy of run.strategies) {
      expect(strategy.pages).toHaveLength(2);
      expect(strategy.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
      expect(strategy.charactersPerPage).toHaveLength(2);
      // Per-page counts must add up to the document total.
      expect(strategy.charactersPerPage.reduce((a, b) => a + b, 0)).toBe(strategy.characterCount);
    }
  });

  it("keeps every page non-empty", () => {
    for (const strategy of run.strategies) {
      expect(strategy.emptyPages).toEqual([]);
      expect(strategy.pagesWithText).toBe(2);
    }
  });

  it("does not recommend the plaintext fallback", () => {
    expect(run.fallbackRecommended).toBe(false);
    expect(run.fallbackReasons).toEqual([]);
  });

  it("recovers the reference text with both strategies", async () => {
    const expected = await loadExpected("clean-agreement");
    for (const strategy of run.strategies) {
      const score = compareToGroundTruth(expected, strategy.text);
      expect(score.tokenCoverage).toBeGreaterThan(0.98);
      expect(score.sequenceSimilarity).toBeGreaterThan(0.98);
      expect(score.readingOrderSuspect).toBe(false);
    }
  });

  it("reports the installed PDF.js version", () => {
    expect(run.pdfjsVersion).toMatch(/^\d+\.\d+/);
  });
});

describe("multi-column fixture", () => {
  let run: ExtractionRun;
  let expected: string;
  beforeAll(async () => {
    run = await extractPdf(await loadFixture("multicolumn-agreement"), {
      fileName: "multicolumn-agreement.pdf",
    });
    expected = await loadExpected("multicolumn-agreement");
  });

  it("extracts the same characters with both strategies", () => {
    const [a, b] = run.strategies;
    expect(a.printableCharacterCount).toBe(b.printableCharacterCount);
    expect(a.printableCharacterCount).toBeGreaterThan(0);
  });

  it("shows that equal character counts hide a reading-order difference", () => {
    const [a, b] = run.strategies;
    const scoreA = compareToGroundTruth(expected, a.text);
    const scoreB = compareToGroundTruth(expected, b.text);

    // Both recover the words.
    expect(scoreA.tokenCoverage).toBeGreaterThan(0.98);
    expect(scoreB.tokenCoverage).toBeGreaterThan(0.98);

    // Only the coordinate strategy recovers the order.
    expect(scoreA.readingOrderSuspect).toBe(true);
    expect(scoreB.readingOrderSuspect).toBe(false);
    expect(scoreB.sequenceSimilarity).toBeGreaterThan(scoreA.sequenceSimilarity + 0.2);
  });

  it("keeps whole column blocks together in coordinate order", () => {
    const text = run.strategies[1].text;
    const definitions = text.indexOf("A. DEFINITIONS");
    const serviceWindow = text.indexOf('"Service Window"');
    const serviceLevels = text.indexOf("B. SERVICE LEVELS");
    // The last line of column A must come before the heading of column B.
    expect(definitions).toBeGreaterThanOrEqual(0);
    expect(serviceWindow).toBeGreaterThan(definitions);
    expect(serviceLevels).toBeGreaterThan(serviceWindow);
  });
});

describe("scanned image-only fixture", () => {
  let run: ExtractionRun;
  beforeAll(async () => {
    run = await extractPdf(await loadFixture("scanned-agreement"), {
      fileName: "scanned-agreement.pdf",
    });
  });

  it("is never reported as a success", () => {
    expect(run.status).toBe("failed");
    for (const strategy of run.strategies) {
      expect(strategy.status).toBe("failed");
    }
  });

  it("is identified as a scan rather than a generic failure", () => {
    expect(run.looksScanned).toBe(true);
    expect(run.fallbackReasons).toContain("scanned-no-text-layer");
    expect(run.warnings.join(" ")).toContain("does not perform OCR");
  });

  it("records the page as empty while still counting it", () => {
    expect(run.pageCount).toBe(1);
    for (const strategy of run.strategies) {
      expect(strategy.emptyPages).toEqual([1]);
      expect(strategy.printableCharacterCount).toBe(0);
    }
  });

  it("recommends the plaintext fallback", () => {
    expect(run.fallbackRecommended).toBe(true);
  });
});

describe("corrupt fixture", () => {
  let run: ExtractionRun;
  beforeAll(async () => {
    run = await extractPdf(await loadFixture("corrupt-agreement"), {
      fileName: "corrupt-agreement.pdf",
    });
  });

  it("fails visibly instead of returning a quiet empty success", () => {
    expect(run.status).toBe("failed");
    expect(run.fallbackRecommended).toBe(true);
    expect(run.fallbackReasons.length).toBeGreaterThan(0);
  });

  it("produces no printable characters", () => {
    for (const strategy of run.strategies) {
      expect(strategy.printableCharacterCount).toBe(0);
    }
  });

  it("explains itself without leaking a stack trace", () => {
    const surfaced = [run.error ?? "", ...run.warnings, ...run.strategies.flatMap((s) => s.warnings)];
    for (const message of surfaced) {
      expect(message).not.toContain("at ");
      expect(message).not.toContain(".js:");
    }
  });
});

describe("garbage input that is not a PDF at all", () => {
  it("fails without throwing", async () => {
    const run = await extractPdf(new TextEncoder().encode("this is plain text, not a PDF"), {
      fileName: "notes.txt",
    });
    expect(run.status).toBe("failed");
    expect(run.error).toBeTruthy();
    expect(run.fallbackRecommended).toBe(true);
  });
});

describe("error messaging", () => {
  it("maps a password exception to the password-protected reason", () => {
    const error = Object.assign(new Error("No password given"), { name: "PasswordException" });
    expect(classifyError(error)).toBe("password-protected");
    expect(describeError(error)).toContain("password protected");
  });

  it("maps an invalid-PDF exception to a readable sentence", () => {
    const error = Object.assign(new Error("Invalid PDF structure."), {
      name: "InvalidPDFException",
    });
    expect(classifyError(error)).toBe("document-unreadable");
    expect(describeError(error)).toContain("could not parse");
  });

  it("maps a timeout to the timeout reason", () => {
    const error = Object.assign(new Error("too slow"), { name: "TimeoutError" });
    expect(classifyError(error)).toBe("extraction-timeout");
    expect(describeError(error)).toContain("time budget");
  });

  it("never surfaces a stack trace for an unknown error", () => {
    const error = new Error("boom\n    at Object.<anonymous> (/src/secret/path.js:12:34)");
    const described = describeError(error);
    expect(described).toContain("boom");
    expect(described).not.toContain("secret/path.js");
  });

  it("truncates an absurdly long message", () => {
    const described = describeError(new Error("x".repeat(5000)));
    expect(described.length).toBeLessThan(250);
    expect(described).toContain("...");
  });
});
