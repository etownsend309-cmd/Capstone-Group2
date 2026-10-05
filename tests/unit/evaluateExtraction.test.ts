import { describe, expect, it } from "vitest";

import {
  buildPages,
  decideFallback,
  emptyPageNumbers,
  evaluateExtraction,
  isEffectivelyEmpty,
  isUsable,
  isWhitespaceOnly,
  LOW_TEXT_THRESHOLD_PER_PAGE,
  normalizeForComparison,
  printableCharacterCount,
} from "../../src/pdf/evaluateExtraction";
import type { ExtractionRun, StrategyResult } from "../../src/pdf/types";

describe("printableCharacterCount", () => {
  it("counts letters, digits, and punctuation", () => {
    expect(printableCharacterCount("abc 123!")).toBe(7);
  });

  it("ignores every flavour of whitespace", () => {
    expect(printableCharacterCount(" \t\n\r\u00a0\u2003")).toBe(0);
  });

  it("ignores zero-width and control characters", () => {
    expect(printableCharacterCount("\u200b\u200c\u0000\ufeff")).toBe(0);
  });

  it("counts non-latin scripts", () => {
    expect(printableCharacterCount("日本語")).toBe(3);
  });
});

describe("empty and whitespace-only detection", () => {
  it("treats an empty string as empty", () => {
    expect(isEffectivelyEmpty("")).toBe(true);
    expect(isEffectivelyEmpty(null)).toBe(true);
    expect(isEffectivelyEmpty(undefined)).toBe(true);
  });

  it("treats whitespace as empty but distinguishes it from having no characters", () => {
    expect(isEffectivelyEmpty("   \n\n  ")).toBe(true);
    expect(isWhitespaceOnly("   \n\n  ")).toBe(true);
    expect(isWhitespaceOnly("")).toBe(false);
  });

  it("does not treat real content as empty", () => {
    expect(isEffectivelyEmpty("  a  ")).toBe(false);
    expect(isWhitespaceOnly("  a  ")).toBe(false);
  });

  it("reports 1-based empty page numbers", () => {
    const pages = buildPages(["text", "   ", "", "more text"]);
    expect(emptyPageNumbers(pages)).toEqual([2, 3]);
  });
});

describe("normalizeForComparison", () => {
  it("normalizes line endings and collapses repeated whitespace", () => {
    expect(normalizeForComparison("a  b\r\n\r\n\r\nc\t\td")).toBe("a b\nc d");
  });
});

describe("buildPages", () => {
  it("preserves page boundaries and measures each page independently", () => {
    const pages = buildPages(["one", "", "three   "]);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(pages[0]).toMatchObject({ characterCount: 3, printableCharacterCount: 3, isEmpty: false });
    expect(pages[1]).toMatchObject({ characterCount: 0, printableCharacterCount: 0, isEmpty: true });
    expect(pages[2]).toMatchObject({ characterCount: 8, printableCharacterCount: 5, isEmpty: false });
  });
});

describe("status classification", () => {
  const longPage = "x".repeat(200);

  it("reports success only when every page has ample text", () => {
    const result = evaluateExtraction({ pages: buildPages([longPage, longPage]) });
    expect(result.status).toBe("success");
    expect(result.fallbackRecommended).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("never reports success for zero extracted characters", () => {
    const result = evaluateExtraction({ pages: buildPages(["", ""]) });
    expect(result.status).toBe("failed");
    expect(result.fallbackReasons).toContain("all-pages-empty");
  });

  it("never reports success for whitespace-only output", () => {
    const result = evaluateExtraction({ pages: buildPages(["   \n   ", "\t\t"]) });
    expect(result.status).toBe("failed");
    expect(result.fallbackReasons).toContain("whitespace-only");
    expect(result.fallbackReasons).toContain("all-pages-empty");
  });

  it("fails when a hard error occurred, even if pages carry text", () => {
    const result = evaluateExtraction({
      pages: buildPages([longPage]),
      hardError: "PDF.js could not parse this file.",
    });
    expect(result.status).toBe("failed");
    expect(result.fallbackReasons).toContain("extraction-error");
  });

  it("fails when the document reports zero pages", () => {
    const result = evaluateExtraction({ pages: [] });
    expect(result.status).toBe("failed");
    expect(result.fallbackReasons).toContain("no-pages");
  });

  it("warns, rather than fails, when only some pages are empty", () => {
    const result = evaluateExtraction({ pages: buildPages([longPage, "", longPage]) });
    expect(result.status).toBe("warning");
    expect(result.emptyPages).toEqual([2]);
    expect(result.warnings.join(" ")).toContain("page 2");
  });

  it("warns when a page threw but others succeeded", () => {
    const result = evaluateExtraction({
      pages: buildPages([longPage, longPage]),
      pageFailures: [2],
    });
    expect(result.status).toBe("warning");
    expect(result.warnings.join(" ")).toContain("page 2");
  });
});

describe("low-text threshold", () => {
  it("flags output below the documented threshold", () => {
    // 20 printable characters over 1 page, under the default of 50.
    const result = evaluateExtraction({ pages: buildPages(["y".repeat(20)]) });
    expect(result.status).toBe("warning");
    expect(result.fallbackReasons).toContain("low-text-volume");
    expect(result.warnings.join(" ")).toContain("not a confidence score");
  });

  it("does not flag output at or above the threshold", () => {
    const result = evaluateExtraction({
      pages: buildPages(["y".repeat(LOW_TEXT_THRESHOLD_PER_PAGE)]),
    });
    expect(result.fallbackReasons).not.toContain("low-text-volume");
    expect(result.status).toBe("success");
  });

  it("averages across pages rather than judging each page alone", () => {
    // 120 printable characters over 2 pages = 60/page, above the threshold.
    const result = evaluateExtraction({ pages: buildPages(["y".repeat(110), "y".repeat(10)]) });
    expect(result.fallbackReasons).not.toContain("low-text-volume");
  });

  it("honours a custom threshold", () => {
    const result = evaluateExtraction({
      pages: buildPages(["y".repeat(80)]),
      lowTextThreshold: 100,
    });
    expect(result.fallbackReasons).toContain("low-text-volume");
  });

  it("ignores whitespace padding when measuring volume", () => {
    // 2000 raw characters, but only 10 printable ones.
    const padded = `${" ".repeat(1990)}abcdefghij`;
    const result = evaluateExtraction({ pages: buildPages([padded]) });
    expect(result.characterCount).toBe(2000);
    expect(result.printableCharacterCount).toBe(10);
    expect(result.fallbackReasons).toContain("low-text-volume");
  });
});

function makeStrategy(overrides: Partial<StrategyResult> = {}): StrategyResult {
  return {
    strategy: "content-order",
    strategyName: "Strategy A",
    strategyDescription: "",
    status: "success",
    elapsedMs: 1,
    pageCount: 1,
    characterCount: 100,
    printableCharacterCount: 100,
    charactersPerPage: [100],
    printableCharactersPerPage: [100],
    emptyPages: [],
    pagesWithText: 1,
    pages: buildPages(["x".repeat(100)]),
    text: "x".repeat(100),
    warnings: [],
    fallbackRecommended: false,
    fallbackReasons: [],
    ...overrides,
  };
}

function makeRun(overrides: Partial<ExtractionRun> = {}): ExtractionRun {
  return {
    fileName: "fixture.pdf",
    fileSizeBytes: 1000,
    pdfjsVersion: "test",
    totalElapsedMs: 5,
    pageCount: 1,
    status: "success",
    strategies: [makeStrategy()],
    warnings: [],
    error: null,
    fallbackRecommended: false,
    fallbackReasons: [],
    looksScanned: false,
    testedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isUsable", () => {
  it("requires both a non-failed status and printable characters", () => {
    expect(isUsable(makeStrategy())).toBe(true);
    expect(isUsable(makeStrategy({ status: "failed" }))).toBe(false);
    expect(isUsable(makeStrategy({ printableCharacterCount: 0 }))).toBe(false);
  });
});

describe("plaintext fallback rules", () => {
  it("does not trigger for a healthy extraction", () => {
    const decision = decideFallback(makeRun());
    expect(decision.triggered).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it("triggers when PDF.js failed outright", () => {
    const decision = decideFallback(
      makeRun({
        status: "failed",
        error: "PDF.js could not parse this file.",
        fallbackReasons: ["document-unreadable"],
        strategies: [makeStrategy({ status: "failed", printableCharacterCount: 0 })],
      }),
    );
    expect(decision.triggered).toBe(true);
    expect(decision.reasons).toContain("document-unreadable");
  });

  it("triggers when every strategy produced no printable text", () => {
    const empty = makeStrategy({
      status: "failed",
      printableCharacterCount: 0,
      fallbackReasons: ["all-pages-empty"],
    });
    const decision = decideFallback(makeRun({ status: "failed", strategies: [empty, empty] }));
    expect(decision.triggered).toBe(true);
    expect(decision.reasons).toContain("all-pages-empty");
  });

  it("triggers for a scanned document with no text layer", () => {
    const decision = decideFallback(
      makeRun({
        status: "failed",
        looksScanned: true,
        fallbackReasons: ["scanned-no-text-layer", "all-pages-empty"],
        strategies: [makeStrategy({ status: "failed", printableCharacterCount: 0 })],
      }),
    );
    expect(decision.reasons).toContain("scanned-no-text-layer");
    expect(decision.explanations.join(" ")).toContain("does not perform OCR");
  });

  it("triggers when a reviewer marks an otherwise healthy result unusable", () => {
    const decision = decideFallback(makeRun(), true);
    expect(decision.triggered).toBe(true);
    expect(decision.reasons).toEqual(["human-marked-unusable"]);
  });

  it("does not trigger when at least one strategy produced usable text", () => {
    const decision = decideFallback(
      makeRun({
        status: "warning",
        strategies: [makeStrategy({ status: "failed", printableCharacterCount: 0 }), makeStrategy()],
      }),
    );
    expect(decision.triggered).toBe(false);
  });

  it("returns no reasons when there is no run yet", () => {
    expect(decideFallback(null).triggered).toBe(false);
  });

  it("gives a plain-language explanation for every reason it reports", () => {
    const decision = decideFallback(
      makeRun({
        status: "failed",
        fallbackReasons: ["low-text-volume"],
        strategies: [makeStrategy({ status: "failed", printableCharacterCount: 0 })],
      }),
    );
    expect(decision.explanations).toHaveLength(decision.reasons.length);
    for (const explanation of decision.explanations) {
      expect(explanation.length).toBeGreaterThan(10);
    }
  });
});
