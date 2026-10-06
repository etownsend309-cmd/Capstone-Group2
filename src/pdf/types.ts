/**
 * Shared result schema for the PDF extraction proof of concept (KAN-402).
 *
 * Everything here is produced client-side by PDF.js. There is no backend and no
 * server-side extraction.
 */

export type ExtractionStatus = "success" | "warning" | "failed";

/**
 * The documented reasons that can recommend switching to supplied plaintext.
 * The UI always shows which of these fired.
 */
export type FallbackReason =
  | "extraction-error"
  | "document-unreadable"
  | "password-protected"
  | "no-pages"
  | "all-pages-empty"
  | "whitespace-only"
  | "low-text-volume"
  | "scanned-no-text-layer"
  | "extraction-timeout"
  | "human-marked-unusable";

/** The two PDF.js reconstruction strategies under comparison. */
export type StrategyId = "content-order" | "coordinate-order";

/**
 * One text fragment as PDF.js reports it, reduced to the fields the strategies
 * need. Keeping this separate from PDF.js' own `TextItem` keeps the ordering
 * algorithms unit-testable without loading a PDF.
 */
export interface TextFragment {
  /** The fragment's characters. */
  text: string;
  /** Horizontal position in PDF user space, increasing to the right. */
  x: number;
  /** Vertical position in PDF user space, increasing upward. */
  y: number;
  /** Rendered width of the fragment. */
  width: number;
  /** Approximate glyph height, used to decide what counts as "the same line". */
  height: number;
  /** PDF.js' own end-of-line marker for this fragment. */
  hasEOL: boolean;
}

/** One page of a single strategy's output. */
export interface PageText {
  pageNumber: number;
  text: string;
  characterCount: number;
  printableCharacterCount: number;
  isEmpty: boolean;
}

/** Metrics and classification for one strategy across the whole document. */
export interface StrategyResult {
  strategy: StrategyId;
  strategyName: string;
  /** One-line description of how this strategy orders text. */
  strategyDescription: string;
  status: ExtractionStatus;
  /** Time spent reconstructing text for this strategy, in milliseconds. */
  elapsedMs: number;
  pageCount: number;
  characterCount: number;
  printableCharacterCount: number;
  charactersPerPage: number[];
  printableCharactersPerPage: number[];
  emptyPages: number[];
  pagesWithText: number;
  pages: PageText[];
  /** Full text with pages joined by a blank line. Page boundaries stay in `pages`. */
  text: string;
  warnings: string[];
  fallbackRecommended: boolean;
  fallbackReasons: FallbackReason[];
}

/** The complete outcome of running PDF.js over one file. */
export interface ExtractionRun {
  fileName: string;
  fileSizeBytes: number;
  pdfjsVersion: string;
  /** Wall-clock time for the whole run, including parsing. */
  totalElapsedMs: number;
  /** Page count PDF.js reported, even when extraction produced nothing. */
  pageCount: number;
  status: ExtractionStatus;
  strategies: StrategyResult[];
  /** Document-level warnings, distinct from per-strategy warnings. */
  warnings: string[];
  /** Short, human-readable failure message. Never a stack trace. */
  error: string | null;
  fallbackRecommended: boolean;
  fallbackReasons: FallbackReason[];
  /** True when pages carry images but no text layer: the scanned-PDF signature. */
  looksScanned: boolean;
  testedAt: string;
}

export type PdfCategory = "clean" | "difficult" | "scanned" | "unknown";

export const CATEGORY_LABELS: Record<PdfCategory, string> = {
  clean: "Clean (machine generated)",
  difficult: "Multi-column / difficult",
  scanned: "Scanned / image-only",
  unknown: "Unknown",
};

/** Which text the tester has accepted as the working source for this document. */
export interface TextSource {
  kind: "pdf-extraction" | "supplied-plaintext";
  label: string;
  characterCount: number;
  strategy?: StrategyId;
  origin?: "pasted" | "uploaded";
  confirmedAt?: string;
}
