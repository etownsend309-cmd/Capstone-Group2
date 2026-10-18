import { useState } from "react";
import type { RequesterSubmission } from "../types";

function dateLabel(value?: string, dateOnly = false) {
  if (!value) return "Not recorded";
  const date = new Date(dateOnly ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export default function RequesterTracker({ submissions, onRevise }: {
  submissions: RequesterSubmission[];
  onRevise: (id: string, file: File) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const active = submissions.find((item) => item.id === selectedId) ?? submissions[0];

  const uploadRevision = async (file?: File) => {
    if (!file || !active || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await onRevise(active.id, file);
      setMessage("New version submitted for review. The previous outcome no longer applies.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The new version could not be read.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Requester submission tracker">
      <div className="page-heading">
        <span className="eyebrow">Agreement status</span>
        <h1>My submissions</h1>
        <p>Track your agreements and read the outcome once a review is complete.</p>
      </div>
      {!submissions.length ? (
        <div className="panel empty-state"><h2>No submissions for this Requester</h2><p>New agreements submitted under this Requester profile will appear here.</p></div>
      ) : (
        <>
          <div className="panel tracker-table-wrap">
            <table className="tracker-table">
              <caption>{submissions.length} submission{submissions.length === 1 ? "" : "s"}</caption>
              <thead><tr><th scope="col">Agreement</th><th scope="col">Vendor</th><th scope="col">Submission date</th><th scope="col">Needed-by date</th><th scope="col">Status</th><th scope="col">Current version</th></tr></thead>
              <tbody>{submissions.map((item) => (
                <tr key={item.id} aria-selected={item.id === active?.id}>
                  <th scope="row"><button className="text-button" onClick={() => { setSelectedId(item.id); setError(""); setMessage(""); }}>{item.name}</button></th>
                  <td>{item.vendor}</td><td>{dateLabel(item.submittedAt)}</td><td>{dateLabel(item.neededBy, true)}</td><td>{item.status}</td><td>{item.currentVersion ? `Version ${item.currentVersion}` : "Not recorded"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {active && (
            <section className="panel tracker-detail" aria-label="Submission details">
              <h2>{active.name}</h2>
              <dl className="tracker-facts">
                <div><dt>Final outcome</dt><dd>{active.completedAt ? active.status : "Review not completed"}</dd></div>
                <div><dt>Review completed</dt><dd>{active.completedAt ? dateLabel(active.completedAt) : "Not completed"}</dd></div>
              </dl>
              <h3>Conditions</h3>
              {active.completedAt ? active.conditions.length ? <ul>{active.conditions.map((condition, index) => <li key={index}>{condition}</li>)}</ul> : <p>No conditions recorded.</p> : <p>Conditions will appear when the review is complete.</p>}
              <h3>Document versions</h3>
              {active.versions.length ? <ul>{active.versions.map((version) => <li key={version.version}>Version {version.version}: {version.fileName} · {dateLabel(version.uploadedAt)}</li>)}</ul> : <p>No version history was recorded for this older submission.</p>}
              <label className="revision-upload"><span>Submit a revised agreement</span><input type="file" accept="application/pdf,.pdf,text/plain,.txt" disabled={busy} onChange={(event) => { void uploadRevision(event.target.files?.[0]); event.target.value = ""; }} /></label>
              {busy && <p role="status">Reading the new version…</p>}
              {message && <p role="status">{message}</p>}
              {error && <p className="error-message" role="alert">{error}</p>}
            </section>
          )}
        </>
      )}
    </section>
  );
}
