/**
 * Experiment report export.
 *
 * Privacy rule enforced here: the exported report carries metrics, warnings,
 * and the tester's notes. It does NOT carry the extracted document text by
 * default. A reviewer has to opt in explicitly, and even then the text is cut
 * to a short excerpt with a visible truncation marker.
 */

import { FALLBACK_REASON_LABELS } from "./evaluateExtraction";
import { CATEGORY_LABELS, type ExtractionRun, type FallbackReason, type PdfCategory, type TextSource } from "./types";

/** Cap applied when a reviewer deliberately opts into including text. */
export const OPT_IN_EXCERPT_CHARS = 300;

export interface ReportInput {
  run: ExtractionRun;
  category: PdfCategory;
  /** Anonymized label. The real filename is not required to identify a test. */
  documentLabel: string;
  fallbackTriggered: boolean;
  fallbackReasons: FallbackReason[];
  activeSource: TextSource;
  markedUnusable: boolean;
  preferredStrategy: string | null;
  preferenceReason: string;
  notes: string;
  /** Opt-in only. Defaults to false everywhere this is constructed. */
  includeExtractedText?: boolean;
}

export interface ReportStrategyEntry {
  strategy: string;
  strategyName: string;
  strategyDescription: string;
  status: string;
  elapsedMs: number;
  pageCount: number;
  characterCount: number;
  printableCharacterCount: number;
  charactersPerPage: number[];
  emptyPages: number[];
  pagesWithText: number;
  warnings: string[];
  fallbackRecommended: boolean;
  fallbackReasons: string[];
  extractedTextExcerpt?: string;
}

export interface ExperimentReport {
  reportVersion: string;
  ticket: string;
  testedAt: string;
  library: { name: string; version: string };
  document: {
    label: string;
    category: PdfCategory;
    categoryLabel: string;
    sizeBytes: number;
    pageCount: number;
  };
  containsExtractedText: boolean;
  privacyNotice: string;
  overallStatus: string;
  totalElapsedMs: number;
  looksScanned: boolean;
  documentWarnings: string[];
  error: string | null;
  strategies: ReportStrategyEntry[];
  fallback: {
    triggered: boolean;
    reasons: string[];
    reasonExplanations: string[];
    markedUnusableByReviewer: boolean;
    activeSourceKind: TextSource["kind"];
    activeSourceLabel: string;
  };
  preference: { strategy: string | null; reason: string };
  notes: string;
  caveats: string[];
}

const PRIVACY_NOTICE =
  "Metrics only. Extracted document text is excluded from this report by default so contract " +
  "content is not copied into shared artifacts.";

const PRIVACY_NOTICE_OPT_IN =
  "WARNING: a reviewer opted in to including text excerpts, so this file may contain contract " +
  "content. Handle it accordingly and do not commit it.";

const CAVEATS = [
  "Character count is a volume measure. It does not prove correct reading order or extraction quality.",
  "The low-text threshold is a character-count heuristic, not a model confidence score.",
  "Both strategies use PDF.js. They compare reconstruction approaches, not independent PDF engines.",
];

export function buildReport(input: ReportInput): ExperimentReport {
  const includeText = input.includeExtractedText === true;
  const { run } = input;

  const strategies: ReportStrategyEntry[] = run.strategies.map((strategy) => {
    const entry: ReportStrategyEntry = {
      strategy: strategy.strategy,
      strategyName: strategy.strategyName,
      strategyDescription: strategy.strategyDescription,
      status: strategy.status,
      elapsedMs: strategy.elapsedMs,
      pageCount: strategy.pageCount,
      characterCount: strategy.characterCount,
      printableCharacterCount: strategy.printableCharacterCount,
      charactersPerPage: strategy.charactersPerPage,
      emptyPages: strategy.emptyPages,
      pagesWithText: strategy.pagesWithText,
      warnings: strategy.warnings,
      fallbackRecommended: strategy.fallbackRecommended,
      fallbackReasons: strategy.fallbackReasons,
    };
    if (includeText && strategy.text) {
      entry.extractedTextExcerpt = excerpt(strategy.text);
    }
    return entry;
  });

  return {
    reportVersion: "1.0",
    ticket: "KAN-402 PDF extraction proof of concept",
    testedAt: run.testedAt,
    library: { name: "pdfjs-dist", version: run.pdfjsVersion },
    document: {
      label: input.documentLabel,
      category: input.category,
      categoryLabel: CATEGORY_LABELS[input.category],
      sizeBytes: run.fileSizeBytes,
      pageCount: run.pageCount,
    },
    containsExtractedText: includeText,
    privacyNotice: includeText ? PRIVACY_NOTICE_OPT_IN : PRIVACY_NOTICE,
    overallStatus: run.status,
    totalElapsedMs: run.totalElapsedMs,
    looksScanned: run.looksScanned,
    documentWarnings: run.warnings,
    error: run.error,
    strategies,
    fallback: {
      triggered: input.fallbackTriggered,
      reasons: input.fallbackReasons,
      reasonExplanations: input.fallbackReasons.map(
        (reason) => FALLBACK_REASON_LABELS[reason] ?? reason,
      ),
      markedUnusableByReviewer: input.markedUnusable,
      activeSourceKind: input.activeSource.kind,
      activeSourceLabel: input.activeSource.label,
    },
    preference: { strategy: input.preferredStrategy, reason: input.preferenceReason },
    notes: input.notes,
    caveats: CAVEATS,
  };
}

function excerpt(text: string): string {
  if (text.length <= OPT_IN_EXCERPT_CHARS) return text;
  return `${text.slice(0, OPT_IN_EXCERPT_CHARS)}\n[...truncated, ${text.length - OPT_IN_EXCERPT_CHARS} characters omitted...]`;
}

export function reportToJson(report: ExperimentReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function reportToMarkdown(report: ExperimentReport): string {
  const lines: string[] = [];
  lines.push("# PDF extraction experiment report");
  lines.push("");
  lines.push(`- **Ticket:** ${report.ticket}`);
  lines.push(`- **Tested at:** ${report.testedAt}`);
  lines.push(`- **Library:** ${report.library.name} ${report.library.version}`);
  lines.push(`- **Document:** ${report.document.label}`);
  lines.push(`- **Category:** ${report.document.categoryLabel}`);
  lines.push(`- **Size:** ${report.document.sizeBytes.toLocaleString("en-US")} bytes`);
  lines.push(`- **Pages:** ${report.document.pageCount}`);
  lines.push(`- **Overall status:** ${report.overallStatus}`);
  lines.push(`- **Total time:** ${report.totalElapsedMs} ms`);
  lines.push(`- **Looks scanned:** ${report.looksScanned ? "yes" : "no"}`);
  lines.push(`- **Contains extracted text:** ${report.containsExtractedText ? "yes (opt-in excerpts)" : "no"}`);
  lines.push("");
  lines.push(`> ${report.privacyNotice}`);
  lines.push("");

  if (report.error) {
    lines.push("## Fatal error");
    lines.push("");
    lines.push(report.error);
    lines.push("");
  }

  lines.push("## Strategy metrics");
  lines.push("");
  lines.push(
    "| Strategy | Status | Latency | Pages | Pages with text | Empty pages | Printable chars | Raw chars | Fallback |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const strategy of report.strategies) {
    lines.push(
      `| ${strategy.strategyName} | ${strategy.status} | ${strategy.elapsedMs} ms | ` +
        `${strategy.pageCount} | ${strategy.pagesWithText} | ` +
        `${strategy.emptyPages.length > 0 ? strategy.emptyPages.join(", ") : "none"} | ` +
        `${strategy.printableCharacterCount.toLocaleString("en-US")} | ` +
        `${strategy.characterCount.toLocaleString("en-US")} | ` +
        `${strategy.fallbackRecommended ? "recommended" : "not recommended"} |`,
    );
  }
  lines.push("");

  const issues = report.strategies.filter((s) => s.warnings.length > 0);
  lines.push("## Warnings");
  lines.push("");
  if (report.documentWarnings.length === 0 && issues.length === 0) {
    lines.push("No warnings were recorded.");
  } else {
    for (const warning of report.documentWarnings) lines.push(`- ${warning}`);
    for (const strategy of issues) {
      for (const warning of strategy.warnings) lines.push(`- **${strategy.strategyName}:** ${warning}`);
    }
  }
  lines.push("");

  lines.push("## Plaintext fallback");
  lines.push("");
  lines.push(`- **Triggered:** ${report.fallback.triggered ? "yes" : "no"}`);
  lines.push(`- **Marked unusable by reviewer:** ${report.fallback.markedUnusableByReviewer ? "yes" : "no"}`);
  lines.push(`- **Active text source:** ${report.fallback.activeSourceLabel}`);
  if (report.fallback.reasons.length > 0) {
    lines.push("- **Reasons:**");
    report.fallback.reasonExplanations.forEach((explanation, index) => {
      lines.push(`  - \`${report.fallback.reasons[index]}\` - ${explanation}`);
    });
  }
  lines.push("");

  lines.push("## Tester preference");
  lines.push("");
  lines.push(`- **Preferred strategy:** ${report.preference.strategy ?? "not recorded"}`);
  lines.push(`- **Reason:** ${report.preference.reason.trim() || "not recorded"}`);
  lines.push("");

  if (report.notes.trim()) {
    lines.push("## Notes");
    lines.push("");
    lines.push(report.notes.trim());
    lines.push("");
  }

  lines.push("## Caveats");
  lines.push("");
  for (const caveat of report.caveats) lines.push(`- ${caveat}`);
  lines.push("");

  if (report.containsExtractedText) {
    lines.push("## Extracted text excerpts (opt-in)");
    lines.push("");
    for (const strategy of report.strategies) {
      if (!strategy.extractedTextExcerpt) continue;
      lines.push(`### ${strategy.strategyName}`);
      lines.push("");
      lines.push("```");
      lines.push(strategy.extractedTextExcerpt);
      lines.push("```");
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

/** Filenames must not leak the original document name. */
export function reportFilename(report: ExperimentReport, extension: "json" | "md"): string {
  const stamp = report.testedAt.replace(/[:.]/g, "-");
  return `pdf-extraction-report-${report.document.category}-${stamp}.${extension}`;
}
