/**
 * Document text extraction for the review workflow.
 *
 * This is a thin adapter over the KAN-402 extraction engine in `src/pdf`. That
 * engine runs both reconstruction strategies and reports detailed diagnostics;
 * the review workflow only needs one block of text plus a page count, so this
 * module picks the better strategy and converts an unusable result into a
 * message a reviewer can act on.
 *
 * Everything runs in the browser. No file or extracted text leaves the machine.
 */

import {
  FALLBACK_REASON_LABELS,
  isUsable,
  MAX_UPLOAD_BYTES,
} from "../pdf/evaluateExtraction";
import { extractPdf } from "../pdf/extractPdf";
import type { ExtractionRun, StrategyId, StrategyResult } from "../pdf/types";

export interface ExtractedDocument {
  text: string;
  /** Pages PDF.js reported. Undefined for plain text, which has no pages. */
  pageCount?: number;
  /** Which reconstruction strategy produced `text`, recorded for traceability. */
  strategy?: StrategyId;
  /** Non-fatal notes worth showing the reviewer, e.g. a low-text warning. */
  warnings: string[];
}

const isTxt = (file: File) =>
  file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt");

const isPdf = (file: File) =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

export async function extractText(file: File): Promise<ExtractedDocument> {
  if (file.size === 0) {
    throw new Error("That file is empty.");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
    throw new Error(`That file is larger than the ${limitMb} MB limit for this prototype.`);
  }

  if (isTxt(file)) {
    const text = (await file.text()).trim();
    if (!text) throw new Error("That text file contains no readable text.");
    return { text, warnings: [] };
  }

  if (!isPdf(file)) {
    throw new Error("Please choose a PDF or plain-text file.");
  }

  const run = await extractPdf(await file.arrayBuffer(), {
    fileName: file.name,
    fileSizeBytes: file.size,
  });

  const chosen = chooseStrategy(run);
  if (!chosen) throw new Error(explainFailure(run));

  return {
    text: chosen.text,
    pageCount: run.pageCount,
    strategy: chosen.strategy,
    warnings: [...run.warnings, ...chosen.warnings],
  };
}

/**
 * Prefer coordinate reconstruction (Strategy B), falling back to content-stream
 * order (Strategy A).
 *
 * The committed benchmark is the reason for that order: the two strategies tie
 * on single-column documents, but on a two-column agreement Strategy A scored
 * 60.6% sequence similarity against ground truth where Strategy B scored 100%,
 * because stream order interleaves the columns. Strategy A is still the safety
 * net for documents whose geometry defeats the line grouping.
 */
function chooseStrategy(run: ExtractionRun): StrategyResult | null {
  const byPreference: StrategyId[] = ["coordinate-order", "content-order"];
  const usable = byPreference
    .map((id) => run.strategies.find((strategy) => strategy.strategy === id))
    .filter((strategy): strategy is StrategyResult => Boolean(strategy) && isUsable(strategy!));

  if (usable.length === 0) return null;

  // Guard against a reconstruction that lost text rather than reordering it.
  const [preferred, backup] = usable;
  if (backup && preferred.printableCharacterCount < backup.printableCharacterCount * 0.9) {
    return backup;
  }
  return preferred;
}

/** Turn a failed run into one sentence a reviewer can act on. */
function explainFailure(run: ExtractionRun): string {
  if (run.error) return run.error;

  const reason = run.fallbackReasons[0];
  if (reason) return FALLBACK_REASON_LABELS[reason];

  return "No selectable text was found in that PDF.";
}
