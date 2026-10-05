/**
 * Measurement and classification rules for the extraction POC.
 *
 * Every rule here is deliberately simple and explainable. None of it is a model
 * or a confidence score. If a rule changes, update docs/pdf-extraction-poc.md.
 */

import type {
  ExtractionRun,
  ExtractionStatus,
  FallbackReason,
  PageText,
  StrategyResult,
} from "./types";

/**
 * POC heuristic: fewer than this many printable characters per page is treated
 * as "suspiciously low text volume".
 *
 * This is a raw character count. It says nothing about whether the characters
 * that were extracted are correct, and it is NOT a confidence score.
 */
export const LOW_TEXT_THRESHOLD_PER_PAGE = 50;

/** Documented upload ceiling for the POC. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const FALLBACK_REASON_LABELS: Record<FallbackReason, string> = {
  "extraction-error": "PDF.js raised an error and produced no usable text.",
  "document-unreadable": "The file could not be parsed as a PDF (corrupt or unsupported).",
  "password-protected": "The PDF is password protected, so its text cannot be read.",
  "no-pages": "The document reported zero pages.",
  "all-pages-empty": "Every page produced zero printable characters.",
  "whitespace-only": "The output contained characters, but all of them were whitespace.",
  "low-text-volume": `Printable characters per page fell below the POC threshold of ${LOW_TEXT_THRESHOLD_PER_PAGE}.`,
  "scanned-no-text-layer":
    "Pages carry images but no text layer. This is a scanned or image-only PDF. PDF.js reads " +
    "existing text and does not perform OCR, so supplied plaintext is the only path here.",
  "extraction-timeout": "PDF.js exceeded the time budget for this document.",
  "human-marked-unusable": "A reviewer marked the extraction unusable.",
};

/**
 * Count characters a human would recognise as content.
 *
 * Whitespace, separators, and control/format characters are excluded, so a page
 * containing nothing but newlines can never look like a successful extraction.
 */
export function printableCharacterCount(text: string): number {
  if (!text) return 0;
  return (text.match(/[^\s\p{C}\p{Z}]/gu) ?? []).length;
}

/** True when the text has no printable content at all. */
export function isEffectivelyEmpty(text: string | null | undefined): boolean {
  return printableCharacterCount(text ?? "") === 0;
}

/** True when there are characters present but none of them are printable. */
export function isWhitespaceOnly(text: string | null | undefined): boolean {
  const value = text ?? "";
  return value.length > 0 && printableCharacterCount(value) === 0;
}

/** Normalize line endings and collapse repeated whitespace for comparison. */
export function normalizeForComparison(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .normalize("NFKC")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Turn raw per-page strings into measured pages, preserving page boundaries. */
export function buildPages(perPageText: string[]): PageText[] {
  return perPageText.map((text, index) => {
    const printable = printableCharacterCount(text);
    return {
      pageNumber: index + 1,
      text,
      characterCount: text.length,
      printableCharacterCount: printable,
      isEmpty: printable === 0,
    };
  });
}

/** 1-based page numbers with no printable characters. */
export function emptyPageNumbers(pages: PageText[]): number[] {
  return pages.filter((page) => page.isEmpty).map((page) => page.pageNumber);
}

export interface EvaluateInput {
  pages: PageText[];
  /** A fatal, document-level problem. Present means the run could not complete. */
  hardError?: string | null;
  /** Reasons already known from context, such as a detected scan. */
  seedReasons?: FallbackReason[];
  /** Pages PDF.js threw on individually. */
  pageFailures?: number[];
  lowTextThreshold?: number;
}

export interface Evaluation {
  status: ExtractionStatus;
  warnings: string[];
  fallbackReasons: FallbackReason[];
  fallbackRecommended: boolean;
  characterCount: number;
  printableCharacterCount: number;
  charactersPerPage: number[];
  printableCharactersPerPage: number[];
  emptyPages: number[];
  pagesWithText: number;
}

/**
 * Derive status, warnings, and fallback reasons.
 *
 * The one rule that must never bend: a run that produced no printable
 * characters is never reported as a success.
 */
export function evaluateExtraction({
  pages,
  hardError = null,
  seedReasons = [],
  pageFailures = [],
  lowTextThreshold = LOW_TEXT_THRESHOLD_PER_PAGE,
}: EvaluateInput): Evaluation {
  const warnings: string[] = [];
  const reasons: FallbackReason[] = [...seedReasons];

  const charactersPerPage = pages.map((page) => page.characterCount);
  const printableCharactersPerPage = pages.map((page) => page.printableCharacterCount);
  const emptyPages = emptyPageNumbers(pages);
  const pageCount = pages.length;
  const characterCount = charactersPerPage.reduce((a, b) => a + b, 0);
  const totalPrintable = printableCharactersPerPage.reduce((a, b) => a + b, 0);

  if (hardError) reasons.push("extraction-error");

  if (pageCount === 0 && !hardError) {
    reasons.push("no-pages");
    warnings.push("The document reported zero pages.");
  }

  if (pageCount > 0 && totalPrintable === 0) {
    reasons.push("all-pages-empty");
    if (characterCount > 0) {
      reasons.push("whitespace-only");
      warnings.push(
        `Extraction returned ${characterCount} characters but none of them were printable (whitespace only).`,
      );
    } else {
      warnings.push("Extraction returned zero characters across every page.");
    }
  } else if (pageCount > 0 && totalPrintable / pageCount < lowTextThreshold) {
    reasons.push("low-text-volume");
    warnings.push(
      `Suspiciously low text volume: ${totalPrintable} printable characters across ${pageCount} page(s), ` +
        `below the POC heuristic of ${lowTextThreshold} per page. This is a character-count heuristic, not a confidence score.`,
    );
  }

  if (emptyPages.length > 0 && totalPrintable > 0) {
    warnings.push(
      `${emptyPages.length} of ${pageCount} page(s) produced no printable text: page ${emptyPages.join(", ")}.`,
    );
  }

  if (pageFailures.length > 0) {
    warnings.push(
      `PDF.js raised an error on ${pageFailures.length} page(s), which were recorded as empty: page ${pageFailures.join(", ")}.`,
    );
  }

  const fallbackReasons = dedupe(reasons);

  let status: ExtractionStatus;
  if (hardError || pageCount === 0 || totalPrintable === 0) {
    status = "failed";
  } else if (fallbackReasons.length > 0 || warnings.length > 0 || pageFailures.length > 0) {
    status = "warning";
  } else {
    status = "success";
  }

  return {
    status,
    warnings,
    fallbackReasons,
    fallbackRecommended: fallbackReasons.length > 0,
    characterCount,
    printableCharacterCount: totalPrintable,
    charactersPerPage,
    printableCharactersPerPage,
    emptyPages,
    pagesWithText: pageCount - emptyPages.length,
  };
}

/** A strategy is usable when it ran and produced at least some printable text. */
export function isUsable(strategy: StrategyResult): boolean {
  return strategy.status !== "failed" && strategy.printableCharacterCount > 0;
}

export interface FallbackDecision {
  triggered: boolean;
  reasons: FallbackReason[];
  /** Plain-language sentence for each reason, for display in the UI. */
  explanations: string[];
}

/**
 * The documented decision point for switching to supplied plaintext.
 *
 * Fires when PDF.js fails outright, every page is empty, the output is
 * whitespace-only, the volume falls below the documented low-text threshold, or
 * a reviewer marks the result unusable.
 *
 * It never switches the source on its own: it only recommends.
 */
export function decideFallback(
  run: ExtractionRun | null,
  markedUnusable = false,
): FallbackDecision {
  const reasons: FallbackReason[] = [];

  if (run) {
    const usable = run.strategies.filter(isUsable);
    if (run.error || usable.length === 0) {
      reasons.push(...run.fallbackReasons);
      for (const strategy of run.strategies) reasons.push(...strategy.fallbackReasons);
    }
  }

  if (markedUnusable) reasons.push("human-marked-unusable");

  const deduped = dedupe(reasons);
  return {
    triggered: deduped.length > 0,
    reasons: deduped,
    explanations: deduped.map((reason) => FALLBACK_REASON_LABELS[reason] ?? reason),
  };
}

export function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
