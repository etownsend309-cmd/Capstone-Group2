import { useEffect, useId, useRef, useState } from "react";

import {
  CALIBRATION,
  confidenceNote,
  confidenceStatus,
  type CalibrationRecord,
  type ClassificationRunIdentity,
} from "../shared/calibration";
import type { ConfidenceIndicator } from "../shared/classifier";

type NotePhase = "closed" | "opening" | "open" | "closing";

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

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
  const [phase, setPhase] = useState<NotePhase>("closed");
  const wrapRef = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const copy = confidenceNote(indicator, run, record);
  const status = confidenceStatus(run, record);
  const shown = phase !== "closed";

  function open() {
    setPhase(prefersReducedMotion() ? "open" : "opening");
  }

  function close() {
    setPhase((current) => {
      if (current === "closed" || current === "closing") return current;
      return prefersReducedMotion() ? "closed" : "closing";
    });
  }

  useEffect(() => {
    if (phase !== "opening") return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setPhase("open"));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "closing") return;
    const timer = window.setTimeout(() => setPhase("closed"), 180);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "open" && phase !== "opening") return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [phase]);

  return (
    <div className="confidence-note-wrap" ref={wrapRef}>
      <button
        type="button"
        className="confidence-info"
        aria-expanded={phase === "open" || phase === "opening"}
        aria-controls={shown ? noteId : undefined}
        aria-label={`About the ${category} confidence rating`}
        onClick={() => {
          if (phase === "open" || phase === "opening") close();
          else open();
        }}
      >
        i
      </button>
      {shown && (
        <div
          id={noteId}
          className={phase === "open" ? "confidence-note is-open" : "confidence-note is-closing"}
          role="note"
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === "clip-path" && phase === "closing") {
              setPhase("closed");
            }
          }}
        >
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
