import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { locateSource } from "../lib/sourceLocation";
import type { AgreementDetail, FindingRecord } from "../shared/api";
import type { IngestionRecord } from "../shared/ingestion";

function OriginalDocument({ agreement, page }: { agreement: AgreementDetail; page: number | null }) {
  const [selected, setSelected] = useState(agreement.documents.at(-1)?.id ?? "");
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<{ id: string; url?: string; text?: string; error?: string }>();
  const document = agreement.documents.find((item) => item.id === selected) ?? agreement.documents.at(-1);
  useEffect(() => {
    if (!document) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let current = true;
    void (async () => {
      try {
        const response = await fetch(api.documentUrl(document.id), { credentials: "same-origin", signal: controller.signal });
        if (!response.ok) throw new Error("The original file could not be opened. Check access or retry.");
        const bytes = await response.arrayBuffer();
        if (!current) return;
        if (document.contentType === "text/plain") {
          setPreview({ id: document.id, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) });
        } else {
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          setPreview({ id: document.id, url: objectUrl });
        }
      } catch (reason) {
        if (current) setPreview({ id: document.id, error: reason instanceof Error ? reason.message : "The original file could not be opened." });
      }
    })();
    return () => { current = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [document, attempt]);
  const shown = preview?.id === document?.id ? preview : undefined;
  return <section aria-label="Original document" className="source-original">
    <h3>Original document</h3>
    {!document ? <p>No original file is stored. Review the available agreement text or request a copy from the submitter.</p> : <>
      {agreement.documents.length > 1 && <label>Stored file<select value={selected} onChange={(event) => setSelected(event.target.value)}>
        {agreement.documents.map((item) => <option value={item.id} key={item.id}>{item.fileName}</option>)}
      </select></label>}
      <a href={api.documentUrl(document.id)} download={document.fileName}>{document.fileName}</a>
      {!shown && <p role="status">Opening original document…</p>}
      {shown?.error && <div role="alert"><p>{shown.error}</p><button type="button" className="secondary-button" onClick={() => setAttempt((value) => value + 1)}>Retry original document</button></div>}
      {shown?.url && <iframe title={`Original document: ${document.fileName}`} src={`${shown.url}${page ? `#page=${page}` : ""}`} />}
      {shown?.text !== undefined && <pre className="source-text">{shown.text}</pre>}
      <p className="source-help">If your browser cannot display this file, use the download link.</p>
    </>}
  </section>;
}

export function SourceWorkspace({ agreement, finding }: { agreement: AgreementDetail; finding?: FindingRecord }) {
  const [record, setRecord] = useState<IngestionRecord>();
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selection, setSelection] = useState<{ findingId: string; occurrence: number }>();
  const mark = useRef<HTMLElement>(null);
  const version = agreement.ingestion?.version;
  const state = agreement.ingestion?.state;
  useEffect(() => {
    let current = true;
    if (state !== "ready") return;
    void api.getIngestion(agreement.id).then((value) => {
      if (current) { setRecord(value); setLoadError(""); }
    }).catch(() => { if (current) setLoadError("Page and section locations could not be loaded. Exact text navigation is still available."); });
    return () => { current = false; };
  }, [agreement.id, version, state, attempt]);
  const verified = record?.agreementId === agreement.id && record.version === version && record.state === state && record.text === agreement.rawText ? record : undefined;
  const gap = finding?.findingType === "gap" || finding?.classification === "gap";
  const locations = gap ? [] : locateSource(agreement.rawText, finding?.sourceText ?? "", verified);
  const occurrence = selection?.findingId === finding?.id ? selection?.occurrence ?? 0 : 0;
  const location = locations[occurrence];
  const highlighted = selection?.findingId === finding?.id && location !== undefined;
  useEffect(() => {
    if (highlighted) { mark.current?.scrollIntoView?.({ block: "center", behavior: "smooth" }); mark.current?.focus(); }
  }, [selection, highlighted, location?.startOffset, location?.endOffset, occurrence, finding?.id]);
  return <section className="source-workspace" aria-label="Agreement source workspace">
    <h3>Agreement and source text</h3>
    {!agreement.rawText.trim() && <div className="permission-banner" role="status">
      <strong>Extracted text unavailable.</strong> You can inspect the original document and continue manual review. Supply verified agreement text in text preparation to record exact-text provision flags. Missing extraction is not evidence that a provision is absent.
    </div>}
    <div className="source-columns">
      <OriginalDocument key={agreement.id} agreement={agreement} page={highlighted ? location.pageStart : null} />
      <section className="source-transcript" aria-label="Full agreement text">
        <h3>{verified?.source === "supplied" ? "Supplied agreement text" : verified?.source === "extracted" ? "Extracted agreement text" : "Stored agreement text"}</h3>
        <p>{version ? `Version ${version} · ` : ""}Character positions refer to the stored agreement text.</p>
        {finding && <div className="source-navigation">
          {gap ? <p>No source span applies to a gap finding. Review its playbook expectation and the whole agreement.</p> : locations.length ? <>
            <button className="secondary-button" type="button" onClick={() => setSelection({ findingId: finding.id, occurrence })}>Go to cited text</button>
            {locations.length > 1 && <label>Citation occurrence<select value={occurrence} onChange={(event) => setSelection({ findingId: finding.id, occurrence: Number(event.target.value) })}>
              {locations.map((item, index) => <option key={item.startOffset} value={index}>Match {index + 1} · Character {item.startOffset}</option>)}
            </select></label>}
            <p aria-live="polite">{locations.length > 1 && `Repeated citation: showing match ${occurrence + 1} of ${locations.length}${locations.length === 100 ? " (first 100)" : ""}. `}
              Characters {location?.startOffset}–{location?.endOffset}{location?.sections.length ? ` · Section ${location.sections.join(", ")}` : ""}
              {location?.pageStart == null ? " · Page location unavailable" : ` · Page ${location.pageStart}${location.pageEnd !== location.pageStart ? `–${location.pageEnd}` : ""}`}</p>
          </> : <p>This citation does not exactly match the stored text. No location has been guessed. Inspect the original and correct the evidence before relying on it.</p>}
        </div>}
        {loadError && <p role="alert">{loadError} <button type="button" className="text-button" onClick={() => setAttempt((value) => value + 1)}>Retry source locations</button></p>}
        {agreement.rawText ? <pre className="source-text" tabIndex={0}>{highlighted ? <>
          {agreement.rawText.slice(0, location.startOffset)}<mark ref={mark} tabIndex={-1} aria-label="Cited source text">{agreement.rawText.slice(location.startOffset, location.endOffset)}</mark>{agreement.rawText.slice(location.endOffset)}
        </> : agreement.rawText}</pre> : <p>No extracted or supplied agreement text is available yet.</p>}
      </section>
    </div>
  </section>;
}
