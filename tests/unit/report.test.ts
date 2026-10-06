import { describe, expect, it } from "vitest";

import { buildPages } from "../../src/pdf/evaluateExtraction";
import {
  buildReport,
  OPT_IN_EXCERPT_CHARS,
  reportFilename,
  reportToJson,
  reportToMarkdown,
  type ReportInput,
} from "../../src/pdf/report";
import type { ExtractionRun, StrategyResult } from "../../src/pdf/types";

/** Distinctive string that must never appear in a default export. */
const SECRET = "CONFIDENTIAL-CLAUSE-MARKER-9137";
const LONG_TEXT = `${SECRET} ${"lorem ipsum dolor sit amet ".repeat(80)}`;

function strategy(overrides: Partial<StrategyResult> = {}): StrategyResult {
  return {
    strategy: "content-order",
    strategyName: "Strategy A - content-stream order",
    strategyDescription: "Concatenates items in stream order.",
    status: "success",
    elapsedMs: 1.5,
    pageCount: 2,
    characterCount: LONG_TEXT.length,
    printableCharacterCount: 1800,
    charactersPerPage: [LONG_TEXT.length, 0],
    printableCharactersPerPage: [1800, 0],
    emptyPages: [2],
    pagesWithText: 1,
    pages: buildPages([LONG_TEXT, ""]),
    text: LONG_TEXT,
    warnings: ["1 of 2 page(s) produced no printable text: page 2."],
    fallbackRecommended: false,
    fallbackReasons: [],
    ...overrides,
  };
}

function run(): ExtractionRun {
  return {
    fileName: "private-agreement.pdf",
    fileSizeBytes: 12345,
    pdfjsVersion: "6.3.289",
    totalElapsedMs: 42,
    pageCount: 2,
    status: "warning",
    strategies: [strategy(), strategy({ strategy: "coordinate-order", strategyName: "Strategy B" })],
    warnings: [],
    error: null,
    fallbackRecommended: false,
    fallbackReasons: [],
    looksScanned: false,
    testedAt: "2026-01-02T03:04:05.678Z",
  };
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    run: run(),
    category: "clean",
    documentLabel: "clean-fixture (12,345 bytes)",
    fallbackTriggered: false,
    fallbackReasons: [],
    activeSource: { kind: "pdf-extraction", label: "PDF extraction (PDF.js)", characterCount: 100 },
    markedUnusable: false,
    preferredStrategy: "coordinate-order",
    preferenceReason: "Kept the columns in order.",
    notes: "Ran against the generated fixture.",
    ...overrides,
  };
}

describe("report sanitization", () => {
  it("excludes extracted text by default", () => {
    const report = buildReport(input());
    expect(report.containsExtractedText).toBe(false);
    for (const entry of report.strategies) {
      expect(entry.extractedTextExcerpt).toBeUndefined();
    }
  });

  it("keeps contract text out of the default JSON export", () => {
    const json = reportToJson(buildReport(input()));
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("lorem ipsum");
  });

  it("keeps contract text out of the default Markdown export", () => {
    const markdown = reportToMarkdown(buildReport(input()));
    expect(markdown).not.toContain(SECRET);
    expect(markdown).not.toContain("lorem ipsum");
  });

  it("still reports the metrics that describe the text", () => {
    const json = reportToJson(buildReport(input()));
    expect(json).toContain('"printableCharacterCount": 1800');
    expect(json).toContain('"pageCount": 2');
    expect(json).toContain('"emptyPages"');
  });

  it("truncates text to a short excerpt when a reviewer opts in", () => {
    const report = buildReport(input({ includeExtractedText: true }));
    expect(report.containsExtractedText).toBe(true);
    const excerpt = report.strategies[0].extractedTextExcerpt!;
    expect(excerpt).toContain(SECRET);
    expect(excerpt).toContain("characters omitted");
    expect(excerpt.length).toBeLessThan(LONG_TEXT.length);
    expect(excerpt.startsWith(LONG_TEXT.slice(0, OPT_IN_EXCERPT_CHARS))).toBe(true);
  });

  it("warns loudly in the report when text was opted in", () => {
    const report = buildReport(input({ includeExtractedText: true }));
    expect(report.privacyNotice).toContain("WARNING");
    expect(reportToMarkdown(report)).toContain("opt-in");
  });

  it("does not put the original filename in the report or its filename", () => {
    const report = buildReport(input());
    const json = reportToJson(report);
    expect(json).not.toContain("private-agreement.pdf");
    expect(reportFilename(report, "json")).not.toContain("private-agreement");
    expect(reportFilename(report, "json")).toMatch(/^pdf-extraction-report-clean-.*\.json$/);
    expect(reportFilename(report, "md")).toMatch(/\.md$/);
  });
});

describe("report contents", () => {
  it("records the PDF.js version actually used", () => {
    expect(buildReport(input()).library).toEqual({ name: "pdfjs-dist", version: "6.3.289" });
  });

  it("records fallback reasons with plain-language explanations", () => {
    const report = buildReport(
      input({ fallbackTriggered: true, fallbackReasons: ["scanned-no-text-layer"] }),
    );
    expect(report.fallback.triggered).toBe(true);
    expect(report.fallback.reasonExplanations[0]).toContain("OCR");
    expect(reportToMarkdown(report)).toContain("scanned-no-text-layer");
  });

  it("records the active text source when plaintext was supplied", () => {
    const report = buildReport(
      input({
        activeSource: {
          kind: "supplied-plaintext",
          label: "Supplied plaintext (pasted)",
          characterCount: 500,
          origin: "pasted",
          confirmedAt: "2026-01-02T03:05:00.000Z",
        },
      }),
    );
    expect(report.fallback.activeSourceKind).toBe("supplied-plaintext");
    expect(reportToMarkdown(report)).toContain("Supplied plaintext (pasted)");
  });

  it("always carries the caveat that character count is not quality", () => {
    const markdown = reportToMarkdown(buildReport(input()));
    expect(markdown).toContain("does not prove correct reading order");
  });

  it("produces parseable JSON", () => {
    expect(() => JSON.parse(reportToJson(buildReport(input())))).not.toThrow();
  });
});
