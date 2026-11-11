import { useId, useState } from "react";

import {
  CALIBRATION,
  confidenceNote,
  confidenceStatus,
  type CalibrationRecord,
  type ClassificationRunIdentity,
} from "../shared/calibration";
import type { ConfidenceIndicator } from "../shared/classifier";

/**
 * The short confidence label plus the note that explains it.
 * The note leads with this finding's rating. Counts appear only when the
 * finding's run matches the saved check.
 */
export function ConfidenceNote({
  category,
  indicator,
  run,
  record = CALIBRATION,
}: {
  category: string;
  indicator: ConfidenceIndicator;
  run: ClassificationRunIdentity | null;
  record?: CalibrationRecord | null;
}) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  const copy = confidenceNote(indicator, run, record);
  const status = confidenceStatus(run, record);

  return (
    <div className="confidence-note-wrap">
      <button
        type="button"
        className="confidence-info"
        aria-expanded={open}
        aria-controls={noteId}
        aria-label={`About the ${category} confidence rating`}
        onClick={() => setOpen((current) => !current)}
      >
        i
      </button>
      {open && (
        <div id={noteId} className="confidence-note" role="note">
          <p>
            <strong>{indicator} model confidence · {status}</strong>
          </p>
          {copy.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {copy.setup && <p className="confidence-note-setup">{copy.setup}</p>}
        </div>
      )}
    </div>
  );
}
