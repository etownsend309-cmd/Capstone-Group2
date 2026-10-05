import { useCallback, useMemo, useState } from "react";

import { ExtractionResults } from "./components/ExtractionResults";
import { PdfUpload, validatePdfFile } from "./components/PdfUpload";
import { PlaintextFallback } from "./components/PlaintextFallback";
import { ReportExport } from "./components/ReportExport";
import { formatCount } from "./format";
import {
  decideFallback,
  LOW_TEXT_THRESHOLD_PER_PAGE,
  printableCharacterCount,
} from "../pdf/evaluateExtraction";
import { extractPdf, PDFJS_VERSION } from "../pdf/extractPdf";
import type { ReportInput } from "../pdf/report";
import type { ExtractionRun, PdfCategory, TextSource } from "../pdf/types";

const PDF_SOURCE: TextSource = {
  kind: "pdf-extraction",
  label: "PDF extraction (PDF.js)",
  characterCount: 0,
};

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<PdfCategory>("unknown");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<ExtractionRun | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const [markedUnusable, setMarkedUnusable] = useState(false);
  const [suppliedText, setSuppliedText] = useState("");
  const [suppliedOrigin, setSuppliedOrigin] = useState<"pasted" | "uploaded" | null>(null);
  const [activeSource, setActiveSource] = useState<TextSource>(PDF_SOURCE);

  const [preferredStrategy, setPreferredStrategy] = useState<string | null>(null);
  const [preferenceReason, setPreferenceReason] = useState("");
  const [notes, setNotes] = useState("");

  const fallback = useMemo(
    () => decideFallback(run, markedUnusable),
    [run, markedUnusable],
  );

  const resetAll = useCallback(() => {
    setFile(null);
    setUploadError(null);
    setRun(null);
    setRunning(false);
    setMarkedUnusable(false);
    setSuppliedText("");
    setSuppliedOrigin(null);
    setActiveSource(PDF_SOURCE);
    setPreferredStrategy(null);
    setPreferenceReason("");
    setNotes("");
    setStatusMessage("Cleared. Choose another PDF to start again.");
  }, []);

  const onFileSelected = useCallback((selected: File | null) => {
    const validation = validatePdfFile(selected);
    setRun(null);
    setActiveSource(PDF_SOURCE);
    setMarkedUnusable(false);
    if (!validation.ok) {
      setFile(null);
      setUploadError(validation.message ?? "That file cannot be used.");
      setStatusMessage(validation.message ?? "That file cannot be used.");
      return;
    }
    setFile(selected);
    setUploadError(null);
    setStatusMessage(`Selected ${selected?.name}. Ready to run the extraction.`);
  }, []);

  const runExtraction = useCallback(async () => {
    const validation = validatePdfFile(file);
    if (!validation.ok) {
      setUploadError(validation.message ?? "That file cannot be used.");
      setStatusMessage(validation.message ?? "That file cannot be used.");
      return;
    }
    if (!file) return;

    setRunning(true);
    setUploadError(null);
    setStatusMessage(`Extracting text from ${file.name} with PDF.js...`);

    try {
      const buffer = await file.arrayBuffer();
      const result = await extractPdf(buffer, {
        fileName: file.name,
        fileSizeBytes: file.size,
      });
      setRun(result);
      setActiveSource({
        ...PDF_SOURCE,
        characterCount: result.strategies[0]?.characterCount ?? 0,
        strategy: result.strategies[0]?.strategy,
      });
      setStatusMessage(
        `Extraction finished with status ${result.status}. ` +
          `${result.pageCount} page(s), ` +
          `${formatCount(result.strategies[0]?.printableCharacterCount ?? 0)} printable characters. ` +
          (result.fallbackRecommended
            ? "The supplied plaintext fallback is recommended."
            : "No fallback needed."),
      );
    } catch (error) {
      // extractPdf is designed not to throw; this is the last line of defence.
      console.debug("[app] unexpected extraction failure", error);
      setUploadError("Something went wrong while reading that file. Check the browser console.");
      setStatusMessage("Extraction failed unexpectedly.");
    } finally {
      setRunning(false);
    }
  }, [file]);

  const confirmSupplied = useCallback(() => {
    const confirmedAt = new Date().toISOString();
    setActiveSource({
      kind: "supplied-plaintext",
      label: `Supplied plaintext (${suppliedOrigin ?? "pasted"})`,
      characterCount: suppliedText.length,
      origin: suppliedOrigin ?? "pasted",
      confirmedAt,
    });
    setStatusMessage(
      `Text source changed from PDF extraction to supplied plaintext, ` +
        `${formatCount(printableCharacterCount(suppliedText))} printable characters.`,
    );
  }, [suppliedOrigin, suppliedText]);

  const revertSource = useCallback(() => {
    setActiveSource({
      ...PDF_SOURCE,
      characterCount: run?.strategies[0]?.characterCount ?? 0,
      strategy: run?.strategies[0]?.strategy,
    });
    setStatusMessage("Text source reverted to PDF extraction.");
  }, [run]);

  const buildReportInput = useCallback(
    (includeExtractedText: boolean): ReportInput => ({
      run: run!,
      category,
      documentLabel: `${category}-fixture (${formatCount(run?.fileSizeBytes ?? 0)} bytes)`,
      fallbackTriggered: fallback.triggered,
      fallbackReasons: fallback.reasons,
      activeSource,
      markedUnusable,
      preferredStrategy,
      preferenceReason,
      notes,
      includeExtractedText,
    }),
    [
      activeSource,
      category,
      fallback.reasons,
      fallback.triggered,
      markedUnusable,
      notes,
      preferenceReason,
      preferredStrategy,
      run,
    ],
  );

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="app">
        <header className="masthead">
          <p className="eyebrow">Jira KAN-402 &middot; proof of concept</p>
          <h1>PDF text extraction experiment</h1>
          <p>
            A throwaway harness for evaluating how well PDF.js reads contract PDFs, how it behaves
            on documents it cannot read, and when the team should ask for supplied plaintext
            instead. Everything runs in your browser; no file is uploaded.
          </p>
          <div className="env-strip">
            <span className="chip ok">pdfjs-dist {PDFJS_VERSION}</span>
            <span className="chip">client-side only</span>
            <span className="chip">no OCR</span>
            <span className="chip">low-text heuristic: &lt;{LOW_TEXT_THRESHOLD_PER_PAGE} chars/page</span>
          </div>
        </header>

        <p className="visually-hidden" role="status" aria-live="polite" data-testid="status-message">
          {statusMessage}
        </p>

        <main id="main">
          <PdfUpload
            file={file}
            category={category}
            running={running}
            error={uploadError}
            onFileSelected={onFileSelected}
            onCategoryChange={setCategory}
            onRun={runExtraction}
            onReset={resetAll}
          />

          {statusMessage && (
            <p className="live-status" data-testid="visible-status">
              {statusMessage}
            </p>
          )}

          {run && (
            <ExtractionResults
              run={run}
              markedUnusable={markedUnusable}
              onMarkUnusable={setMarkedUnusable}
            />
          )}

          {run && fallback.triggered && (
            <PlaintextFallback
              reasons={fallback.reasons}
              activeSource={activeSource}
              suppliedText={suppliedText}
              suppliedOrigin={suppliedOrigin}
              onSuppliedTextChange={(text, origin) => {
                setSuppliedText(text);
                setSuppliedOrigin(origin);
              }}
              onConfirm={confirmSupplied}
              onRevert={revertSource}
            />
          )}

          {run && (
            <ReportExport
              buildInput={buildReportInput}
              strategies={run.strategies}
              preferredStrategy={preferredStrategy}
              preferenceReason={preferenceReason}
              notes={notes}
              onPreferredStrategyChange={setPreferredStrategy}
              onPreferenceReasonChange={setPreferenceReason}
              onNotesChange={setNotes}
            />
          )}
        </main>

        <footer className="footnote">
          <p>
            Proof of concept for local evaluation only. Not authenticated, not deployed, and not
            the production architecture. Do not paste real agreement text into any shared artifact.
          </p>
        </footer>
      </div>
    </>
  );
}
