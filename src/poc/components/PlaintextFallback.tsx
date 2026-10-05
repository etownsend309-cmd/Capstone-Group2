import { useRef, useState } from "react";

import { formatCount } from "../format";
import { FALLBACK_REASON_LABELS, printableCharacterCount } from "../../pdf/evaluateExtraction";
import type { FallbackReason, TextSource } from "../../pdf/types";

interface Props {
  reasons: FallbackReason[];
  activeSource: TextSource;
  suppliedText: string;
  suppliedOrigin: "pasted" | "uploaded" | null;
  onSuppliedTextChange: (text: string, origin: "pasted" | "uploaded") => void;
  onConfirm: () => void;
  onRevert: () => void;
}

export function PlaintextFallback({
  reasons,
  activeSource,
  suppliedText,
  suppliedOrigin,
  onSuppliedTextChange,
  onConfirm,
  onRevert,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const printable = printableCharacterCount(suppliedText);
  const confirmed = activeSource.kind === "supplied-plaintext";

  async function handleUpload(file: File | null) {
    setUploadError(null);
    if (!file) return;
    if (!/\.txt$/i.test(file.name) && file.type !== "text/plain") {
      setUploadError(`"${file.name}" is not a .txt file.`);
      return;
    }
    try {
      onSuppliedTextChange(await file.text(), "uploaded");
    } catch {
      setUploadError("That file could not be read as UTF-8 text.");
    }
  }

  return (
    <section
      className="panel fallback"
      aria-labelledby="fallback-heading"
      data-testid="fallback-panel"
    >
      <h2 id="fallback-heading">
        <span className="step-number" aria-hidden="true">
          4
        </span>
        Supplied plaintext fallback
      </h2>
      <p className="panel-hint">
        The documented fallback rule fired. Nothing has been substituted: the active source below
        changes only when you confirm it.
      </p>

      <div
        className={`source-banner ${confirmed ? "supplied" : "pdf"}`}
        role="status"
        data-testid="active-source"
      >
        <strong>Active text source:</strong>
        <span data-testid="active-source-label">{activeSource.label}</span>
        <span className="chip">{formatCount(activeSource.characterCount)} characters</span>
        {confirmed && activeSource.confirmedAt && (
          <span className="chip ok">
            confirmed {new Date(activeSource.confirmedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="alert warn" role="alert" data-testid="fallback-reasons">
        <h3>Why the fallback was offered</h3>
        <ul>
          {reasons.map((reason) => (
            <li key={reason}>
              <code>{reason}</code> - {FALLBACK_REASON_LABELS[reason] ?? reason}
            </li>
          ))}
        </ul>
      </div>

      <label className="field" style={{ marginTop: "1rem" }}>
        <span>Paste supplied plaintext</span>
        <textarea
          value={suppliedText}
          rows={8}
          placeholder="Paste the plaintext supplied alongside the PDF..."
          onChange={(event) => onSuppliedTextChange(event.target.value, "pasted")}
          data-testid="supplied-textarea"
        />
      </label>

      <div className="actions" style={{ marginTop: "0.25rem" }}>
        <button
          type="button"
          className="small"
          onClick={() => fileRef.current?.click()}
          data-testid="upload-txt"
        >
          Upload a .txt file
        </button>
        <button
          type="button"
          className="primary"
          onClick={onConfirm}
          disabled={printable === 0 || confirmed}
          data-testid="confirm-supplied"
        >
          {confirmed ? "Supplied plaintext in use" : "Confirm use of supplied plaintext"}
        </button>
        {confirmed && (
          <button
            type="button"
            className="subtle small"
            onClick={onRevert}
            data-testid="revert-source"
          >
            Revert to PDF extraction
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="text/plain,.txt"
        className="visually-hidden"
        aria-label="Upload a plaintext file"
        data-testid="txt-input"
        onChange={(event) => handleUpload(event.target.files?.[0] ?? null)}
      />

      <p className="footnote" data-testid="supplied-counts">
        Supplied text: {formatCount(suppliedText.length)} characters, {formatCount(printable)}{" "}
        printable{suppliedOrigin ? ` (${suppliedOrigin})` : ""}.
        {printable === 0 && suppliedText.length > 0 && " Whitespace-only text cannot be confirmed."}
      </p>

      {uploadError && (
        <div className="alert error" role="alert" data-testid="txt-upload-error">
          <p>{uploadError}</p>
        </div>
      )}
    </section>
  );
}
