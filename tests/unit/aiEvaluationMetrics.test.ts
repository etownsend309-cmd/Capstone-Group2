import { describe, expect, it } from "vitest";

import { summarizeEvaluation } from "../../experiments/ai-evaluation/metrics";
import type { ApprovedCategory } from "../../src/shared/classifier";

const categories = ["Governing Law", "Audit Rights"] satisfies ApprovedCategory[];

describe("AI evaluation metrics", () => {
  it("calculates per-category precision, recall, and macro averages", () => {
    const summary = summarizeEvaluation(categories, [
      {
        id: "one",
        expected: ["Governing Law", "Audit Rights"],
        predicted: [{ category: "Governing Law" }],
        acceptedEvidence: 1,
        rejectedEvidence: 0,
        latencyMs: 10,
      },
      {
        id: "two",
        expected: [],
        predicted: [{ category: "Governing Law" }],
        acceptedEvidence: 0,
        rejectedEvidence: 1,
        latencyMs: 20,
      },
    ]);

    expect(summary.perCategory[0]).toMatchObject({
      category: "Governing Law",
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 0,
      precision: 0.5,
      recall: 1,
    });
    expect(summary.perCategory[1]).toMatchObject({
      category: "Audit Rights",
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 1,
      precision: 0,
      recall: 0,
    });
    expect(summary.macroPrecision).toBe(0.25);
    expect(summary.macroRecall).toBe(0.5);
    expect(summary.macroF1).toBeCloseTo(1 / 3);
    expect(summary.exactEvidenceAcceptanceRate).toBe(0.5);
    expect(summary.medianLatencyMs).toBe(15);
    expect(summary.confidenceRatings).toEqual([
      { indicator: "high", correct: 0, total: 0 },
      { indicator: "medium", correct: 0, total: 0 },
      { indicator: "low", correct: 0, total: 0 },
    ]);
  });

  it("counts how often each confidence rating matched the expert label", () => {
    const summary = summarizeEvaluation(categories, [
      {
        id: "one",
        expected: ["Governing Law"],
        predicted: [
          { category: "Governing Law", confidenceIndicator: "high" },
          { category: "Audit Rights", confidenceIndicator: "low" },
        ],
        acceptedEvidence: 2,
        rejectedEvidence: 0,
      },
      {
        id: "two",
        expected: ["Audit Rights"],
        predicted: [{ category: "Audit Rights", confidenceIndicator: "high" }],
        acceptedEvidence: 1,
        rejectedEvidence: 0,
      },
    ]);

    expect(summary.confidenceRatings).toEqual([
      { indicator: "high", correct: 2, total: 2 },
      { indicator: "medium", correct: 0, total: 0 },
      { indicator: "low", correct: 0, total: 1 },
    ]);
  });

  it("tracks failures and token totals without producing non-finite values", () => {
    const summary = summarizeEvaluation(categories, [
      {
        id: "failed",
        expected: [],
        predicted: [],
        acceptedEvidence: 0,
        rejectedEvidence: 0,
        latencyMs: 5,
        inputTokens: 100,
        outputTokens: 20,
        failed: true,
      },
    ]);

    expect(summary.failures).toBe(1);
    expect(summary.totalInputTokens).toBe(100);
    expect(summary.totalOutputTokens).toBe(20);
    expect(summary.exactEvidenceAcceptanceRate).toBe(0);
    expect(Number.isFinite(summary.macroF1)).toBe(true);
  });
});
