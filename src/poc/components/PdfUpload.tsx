import { useId, useRef, useState } from "react";

import { formatBytes } from "../format";
import { MAX_UPLOAD_BYTES } from "../../pdf/evaluateExtraction";
import { CATEGORY_LABELS, type PdfCategory } from "../../pdf/types";

export interface FileValidation {
  ok: boolean;
  message?: string;
}

/** Documented upload validation. Exported so the unit tests exercise the real rules. */
export function validatePdfFile(
  file: File | null,
  maxBytes: number = MAX_UPLOAD_BYTES,
): FileValidation {
  if (!file) {
    return { ok: false, message: "Choose a PDF file before running the extraction." };
  }
  const looksPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!looksPdf) {
    return {
      ok: false,
      message: `"${file.name}" is not a PDF. This proof of concept only accepts .pdf files.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, message: `"${file.name}" is empty (0 bytes).` };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      message: `"${file.name}" is ${formatBytes(file.size)}, above the ${formatBytes(maxBytes)} limit documented for this proof of concept.`,
    };
  }
  return { ok: true };
}

interface Props {
  file: File | null;
  category: PdfCategory;
  running: boolean;
  error: string | null;
  onFileSelected: (file: File | null) => void;
  onCategoryChange: (category: PdfCategory) => void;
  onRun: () => void;
  onReset: () => void;
}

export function PdfUpload({
  file,
  category,
  running,
  error,
  onFileSelected,
  onCategoryChange,
  onRun,
  onReset,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const groupName = useId();

  return (
    <section className="panel" aria-labelledby="upload-heading">
      <h2 id="upload-heading">
        <span className="step-number" aria-hidden="true">
          1
        </span>
        Upload a PDF
      </h2>
      <p className="panel-hint">
        One PDF at a time, up to {formatBytes(MAX_UPLOAD_BYTES)}. The file is read and parsed
        entirely in this browser tab. It is never uploaded anywhere and it is discarded when you
        reset.
      </p>

      {!file ? (
        <>
          <button
            type="button"
            className={`dropzone${dragging ? " dragging" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              onFileSelected(event.dataTransfer.files?.[0] ?? null);
            }}
            data-testid="dropzone"
          >
            <strong>Drop a PDF here, or press to browse</strong>
            <span>A single .pdf file</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="visually-hidden"
            aria-label="Choose a PDF file to evaluate"
            data-testid="file-input"
            onChange={(event) => onFileSelected(event.target.files?.[0] ?? null)}
          />
        </>
      ) : (
        <div className="file-summary" data-testid="file-summary">
          <div>
            <div className="file-name" data-testid="file-name">
              {file.name}
            </div>
            <div className="file-meta" data-testid="file-size">
              {formatBytes(file.size)} &middot; {file.type || "type not reported by the browser"}
            </div>
          </div>
          <button type="button" className="subtle small" onClick={onReset} data-testid="remove-file">
            Remove file
          </button>
        </div>
      )}

      <fieldset>
        <legend>Label this PDF</legend>
        <div className="radio-row" role="radiogroup" aria-label="PDF category">
          {(Object.keys(CATEGORY_LABELS) as PdfCategory[]).map((key) => (
            <label key={key} htmlFor={`${groupName}-${key}`}>
              <input
                id={`${groupName}-${key}`}
                type="radio"
                name={groupName}
                value={key}
                checked={category === key}
                onChange={() => onCategoryChange(key)}
                data-testid={`category-${key}`}
              />
              {CATEGORY_LABELS[key]}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <div className="alert error" role="alert" data-testid="upload-error">
          <h3>Cannot run the extraction</h3>
          <p>{error}</p>
        </div>
      )}

      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={onRun}
          disabled={running}
          data-testid="run-extraction"
        >
          {running ? (
            <span className="running">
              <span className="spinner" aria-hidden="true" />
              Extracting...
            </span>
          ) : (
            "Run extraction"
          )}
        </button>
        <button
          type="button"
          className="subtle"
          onClick={onReset}
          disabled={running}
          data-testid="reset-all"
        >
          Reset
        </button>
      </div>
    </section>
  );
}
