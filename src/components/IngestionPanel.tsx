import { useId, useState } from "react";
import { api } from "../lib/api";
import { ingestDocument } from "../lib/ingestDocument";
import type { IngestionRecord, IngestionSummary } from "../shared/ingestion";

export function IngestionPanel({ agreementId, ingestion, onChange, canRecover = true }: {
  agreementId: string;
  ingestion?: IngestionSummary;
  onChange: () => Promise<void>;
  canRecover?: boolean;
}) {
  const fieldId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [record, setRecord] = useState<IngestionRecord>();
  if (!ingestion) return null;
  const execute = async (action: () => Promise<IngestionRecord>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { setRecord(await action()); await onChange(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Text preparation could not be saved. Try again."); }
    finally { setBusy(false); }
  };
  const retry = async () => {
    const current = await api.getIngestion(agreementId);
    if (current.state === "ready") return current;
    const detail = await api.getAgreement(agreementId);
    const document = detail.documents.at(-1);
    if (!document) throw new Error("The original file is unavailable. Supply the agreement text below.");
    const response = await fetch(api.documentUrl(document.id), { credentials: "same-origin" });
    if (!response.ok) throw new Error("The original file could not be retrieved. Try again or supply text.");
    const bytes = await response.arrayBuffer();
    return ingestDocument(agreementId, ingestion.version, new File([bytes], document.fileName, { type: document.contentType }));
  };
  return <section className="ingestion-panel" aria-label="Agreement text preparation" aria-busy={busy}>
    <p aria-live="polite"><strong>{ingestion.state === "ready" ? "Text ready" : ingestion.state === "failed" ? "Text preparation failed" : "Text preparation pending"}</strong>
      {` · Version ${ingestion.version}`}{ingestion.state === "ready" && ` · ${ingestion.segmentCount} sections`}</p>
    {ingestion.state !== "ready" && <>
      <p>{ingestion.error ?? "Your submission is saved. Text preparation runs separately. If it stops, retry or supply text."}</p>
      {canRecover && <fieldset disabled={busy}>
        <legend>Recover text preparation</legend>
        <button className="secondary-button" type="button" onClick={() => void execute(retry)}>Retry saved document</button>
        <label htmlFor={fieldId}>Supplied agreement text</label>
        <textarea id={fieldId} value={text} onChange={(event) => setText(event.target.value)} rows={5} maxLength={2000000} />
        <button type="button" className="secondary-button" disabled={!text.trim()} onClick={() => void execute(() => api.processIngestion(agreementId, { version: ingestion.version, text, source: "supplied" }))}>Use supplied text</button>
      </fieldset>}
    </>}
    {ingestion.state === "ready" && <>
      <p>Ready for manual provision identification. Text preparation does not classify provisions or prove that a provision is absent.</p>
      <button className="secondary-button" type="button" disabled={busy} onClick={() => void execute(() => api.getIngestion(agreementId))}>View source sections</button>
      {record?.state === "ready" && <details open><summary>Source sections</summary><ol>{record.segments.map((segment) => <li key={segment.id}>
        <small>Section {segment.sequence} · Characters {segment.startOffset}–{segment.endOffset}{segment.pageStart !== null ? ` · Page ${segment.pageStart}` : " · Page location unavailable"}</small>
        <pre style={{ whiteSpace: "pre-wrap" }}>{segment.text}</pre>
      </li>)}</ol></details>}
    </>}
    {error && <p role="alert" className="error-message">{error}</p>}
  </section>;
}
