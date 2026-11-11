import type { ConfidenceIndicator } from "./classifier";

/** The model and prompt versions stored with the classification run that produced a finding. */
export interface ClassificationRunIdentity {
  requestedModel: string;
  promptVersion: string;
  schemaVersion: string;
}

export interface RatingCount {
  correct: number;
  total: number;
}

/**
 * Counts from one sealed check of one model, prompt, and schema.
 * Each count is how often findings with that rating matched the expert label.
 */
export interface CalibrationRecord {
  model: string;
  promptVersion: string;
  schemaVersion: string;
  ratings: Record<ConfidenceIndicator, RatingCount>;
}

/**
 * The sealed 10-contract holdout for this model, prompt, and schema.
 * High matched the expert category 68 of 89 times. Medium and low were not used,
 * so their totals stay zero and the note does not quote a rate for them.
 * A finding says "calibrated" only when its classification run matches this record.
 */
export const CALIBRATION: CalibrationRecord = {
  model: "gpt-5.6-terra",
  promptVersion: "clausepilot-classifier-v1",
  schemaVersion: "classifier-output-v1",
  ratings: {
    high: { correct: 68, total: 89 },
    medium: { correct: 0, total: 0 },
    low: { correct: 0, total: 0 },
  },
};

const RATING_ORDER = ["high", "medium", "low"] as const satisfies readonly ConfidenceIndicator[];

const RATING_MEANING: Record<ConfidenceIndicator, string> = {
  high: "High means the model saw a direct, explicit match.",
  medium: "Medium means the model saw an indirect or qualified match.",
  low: "Low means the model saw a weak but possibly relevant match.",
};

export const UNCALIBRATED_AI_REASON =
  "The model returned this quote and it matched the stored agreement text exactly. The confidence indicator is the model's own assessment and is not calibrated.";

export const CALIBRATED_AI_REASON =
  "The model returned this quote and it matched the stored agreement text exactly. The confidence indicator was checked against expert-labeled contracts for this model and prompt.";

/** The saved check for this run, or null when the model, prompt, or schema differs. */
export function matchingCalibration(
  run: ClassificationRunIdentity | null | undefined,
  record: CalibrationRecord | null = CALIBRATION,
): CalibrationRecord | null {
  if (!record || !run) return null;
  if (run.requestedModel !== record.model) return null;
  if (run.promptVersion !== record.promptVersion) return null;
  if (run.schemaVersion !== record.schemaVersion) return null;
  return record;
}

export function confidenceStatus(
  run: ClassificationRunIdentity | null | undefined,
  record: CalibrationRecord | null = CALIBRATION,
): "calibrated" | "not calibrated" {
  return matchingCalibration(run, record) ? "calibrated" : "not calibrated";
}

export function confidenceSummary(
  indicator: ConfidenceIndicator,
  run: ClassificationRunIdentity | null | undefined,
  record: CalibrationRecord | null = CALIBRATION,
): string {
  return `${indicator} model confidence · ${confidenceStatus(run, record)}`;
}

export function aiFindingReason(
  run: ClassificationRunIdentity,
  record: CalibrationRecord | null = CALIBRATION,
): string {
  return matchingCalibration(run, record) ? CALIBRATED_AI_REASON : UNCALIBRATED_AI_REASON;
}

export interface ConfidenceNoteCopy {
  /** The open finding's rating first, then the other two. */
  lines: string[];
  /** Model and prompt, present only when this run matches the saved check. */
  setup: string | null;
}

function countLine(indicator: ConfidenceIndicator, count: RatingCount, primary: boolean): string {
  const meaning = RATING_MEANING[indicator];
  if (count.total === 0) {
    return `${meaning} The checked contracts did not include ${primary ? `a ${indicator} rating` : "this rating"}.`;
  }
  return primary
    ? `${meaning} On the checked contracts, ${indicator} was right ${count.correct} of ${count.total} times.`
    : `${meaning} It was right ${count.correct} of ${count.total} times.`;
}

/** Note text for one finding. Counts appear only when `record` is the check for this run. */
export function confidenceNote(
  indicator: ConfidenceIndicator,
  run: ClassificationRunIdentity | null | undefined,
  record: CalibrationRecord | null = CALIBRATION,
): ConfidenceNoteCopy {
  const matched = matchingCalibration(run, record);
  const lines = RATING_ORDER.map((rating) => {
    if (!matched) return RATING_MEANING[rating];
    return countLine(rating, matched.ratings[rating], rating === indicator);
  });
  const lead = lines.splice(RATING_ORDER.indexOf(indicator), 1)[0]!;
  return {
    lines: [
      lead,
      ...lines,
      matched ? "" : "This finding was not checked against expert-labeled contracts.",
    ].filter((line) => line !== ""),
    setup: matched ? `Checked with ${matched.model} and prompt ${matched.promptVersion}.` : null,
  };
}
