import { useState } from "react";

import { buildReport, reportFilename, reportToJson, reportToMarkdown, type ReportInput } from "../../pdf/report";
import type { StrategyResult } from "../../pdf/types";

interface Props {
  buildInput: (includeExtractedText: boolean) => ReportInput;
  strategies: StrategyResult[];
  preferredStrategy: string | null;
  preferenceReason: string;
  notes: string;
  onPreferredStrategyChange: (value: string | null) => void;
  onPreferenceReasonChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}

function download(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // The anchor has to be in the document and the URL has to outlive the click,
  // otherwise some browsers drop the download.
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ReportExport({
  buildInput,
  strategies,
  preferredStrategy,
  preferenceReason,
  notes,
  onPreferredStrategyChange,
  onPreferenceReasonChange,
  onNotesChange,
}: Props) {
  const [includeText, setIncludeText] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  function exportAs(kind: "json" | "md") {
    const report = buildReport(buildInput(includeText));
    const contents = kind === "json" ? reportToJson(report) : reportToMarkdown(report);
    download(
      reportFilename(report, kind),
      contents,
      kind === "json" ? "application/json" : "text/markdown",
    );
    setPreview(contents);
  }

  return (
    <section className="panel" aria-labelledby="export-heading">
      <h2 id="export-heading">
        <span className="step-number" aria-hidden="true">
          5
        </span>
        Export experiment report
      </h2>
      <p className="panel-hint">
        The report records metrics, warnings, fallback state, and your notes. Extracted document
        text is excluded by default so contract content is not copied into shared artifacts.
      </p>

      <label className="field">
        <span>Which strategy did you prefer?</span>
        <select
          value={preferredStrategy ?? ""}
          onChange={(event) => onPreferredStrategyChange(event.target.value || null)}
          data-testid="preferred-strategy"
        >
          <option value="">Not recorded</option>
          {strategies.map((strategy) => (
            <option key={strategy.strategy} value={strategy.strategy}>
              {strategy.strategyName}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Reason for the preference</span>
        <textarea
          value={preferenceReason}
          placeholder="e.g. same character count, but it kept the two columns in order"
          onChange={(event) => onPreferenceReasonChange(event.target.value)}
          data-testid="preference-reason"
        />
      </label>

      <label className="field">
        <span>Notes</span>
        <textarea
          value={notes}
          placeholder="Observations, failure modes, follow-up questions..."
          onChange={(event) => onNotesChange(event.target.value)}
          data-testid="general-notes"
        />
      </label>

      <label className="check-label">
        <input
          type="checkbox"
          checked={includeText}
          onChange={(event) => setIncludeText(event.target.checked)}
          data-testid="include-text-toggle"
        />
        Include truncated text excerpts (not recommended - the file may then contain contract
        content)
      </label>

      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => exportAs("json")}
          data-testid="export-json"
        >
          Download JSON report
        </button>
        <button type="button" onClick={() => exportAs("md")} data-testid="export-md">
          Download Markdown report
        </button>
      </div>

      {preview && (
        <details style={{ marginTop: "1rem" }} data-testid="report-preview-details">
          <summary>Preview of the file that was just downloaded</summary>
          <pre className="extracted-text" data-testid="report-preview">
            {preview}
          </pre>
        </details>
      )}
    </section>
  );
}
