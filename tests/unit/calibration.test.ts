import { describe, expect, it } from "vitest";

import {
  CALIBRATED_AI_REASON,
  CALIBRATION,
  UNCALIBRATED_AI_REASON,
  aiFindingReason,
  confidenceNote,
  confidenceSummary,
  matchingCalibration,
  type CalibrationRecord,
} from "../../src/shared/calibration";

const record: CalibrationRecord = {
  model: "gpt-5.6-terra",
  promptVersion: "clausepilot-classifier-v1",
  schemaVersion: "classifier-output-v1",
  ratings: {
    high: { correct: 45, total: 50 },
    medium: { correct: 10, total: 20 },
    low: { correct: 1, total: 8 },
  },
};

const run = {
  requestedModel: "gpt-5.6-terra",
  promptVersion: "clausepilot-classifier-v1",
  schemaVersion: "classifier-output-v1",
};

describe("calibration record", () => {
  it("saves the sealed holdout counts for the checked model and prompt", () => {
    expect(CALIBRATION).toEqual({
      model: "gpt-5.6-terra",
      promptVersion: "clausepilot-classifier-v1",
      schemaVersion: "classifier-output-v1",
      ratings: {
        high: { correct: 68, total: 89 },
        medium: { correct: 0, total: 0 },
        low: { correct: 0, total: 0 },
      },
    });
    expect(confidenceSummary("high", run)).toBe("high model confidence · calibrated");
    expect(confidenceNote("high", run).lines[0]).toContain("68 of 89");
    expect(confidenceNote("medium", run).lines[0]).toContain("did not include a medium rating");
    expect(confidenceNote("low", run).setup).toBe("Checked with gpt-5.6-terra and prompt clausepilot-classifier-v1.");
  });

  it("matches only the model, prompt, and schema that were checked", () => {
    expect(matchingCalibration(run, record)).toBe(record);
    expect(matchingCalibration({ ...run, requestedModel: "other-model" }, record)).toBeNull();
    expect(matchingCalibration({ ...run, promptVersion: "clausepilot-classifier-v2" }, record)).toBeNull();
    expect(matchingCalibration({ ...run, schemaVersion: "classifier-output-v2" }, record)).toBeNull();
    expect(matchingCalibration(null, record)).toBeNull();
    expect(matchingCalibration(run, null)).toBeNull();
  });

  it("keeps the saved reason on not calibrated until a check matches", () => {
    expect(aiFindingReason(run, null)).toBe(UNCALIBRATED_AI_REASON);
    expect(aiFindingReason({ ...run, requestedModel: "other-model" }, record)).toBe(UNCALIBRATED_AI_REASON);
    expect(aiFindingReason(run, record)).toBe(CALIBRATED_AI_REASON);
  });

  it("explains the open rating first and leaves the counts out until the run matches", () => {
    expect(confidenceSummary("high", run, null)).toBe("high model confidence · not calibrated");
    expect(confidenceSummary("medium", run, record)).toBe("medium model confidence · calibrated");

    const unchecked = confidenceNote("high", run, null);
    expect(unchecked.lines[0]).toBe("High means the model saw a direct, explicit match.");
    expect(unchecked.lines).toContain("Medium means the model saw an indirect or qualified match.");
    expect(unchecked.lines.at(-1)).toBe("This finding was not checked against expert-labeled contracts.");
    expect(unchecked.lines.join(" ")).not.toContain("45 of 50");
    expect(unchecked.setup).toBeNull();

    const checked = confidenceNote("high", run, record);
    expect(checked.lines[0]).toBe(
      "High means the model saw a direct, explicit match. On the checked contracts, high was right 45 of 50 times.",
    );
    expect(checked.lines[1]).toBe("Medium means the model saw an indirect or qualified match. It was right 10 of 20 times.");
    expect(checked.lines[2]).toBe("Low means the model saw a weak but possibly relevant match. It was right 1 of 8 times.");
    expect(checked.setup).toBe("Checked with gpt-5.6-terra and prompt clausepilot-classifier-v1.");
  });
});
