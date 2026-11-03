import { describe, expect, it } from "vitest";
import { compareExtraction } from "../../experiments/pdf-comparison/metrics";

describe("PDF engine comparison metrics", () => {
  it("reports perfect metrics for matching text", () => {
    expect(compareExtraction("alpha beta beta gamma", "alpha beta beta gamma")).toMatchObject({
      tokenPrecision: 1,
      tokenRecall: 1,
      tokenF1: 1,
      sequenceSimilarity: 1,
    });
  });

  it("penalizes extra and missing tokens separately", () => {
    const result = compareExtraction("alpha beta gamma", "alpha beta extra");
    expect(result.tokenPrecision).toBeCloseTo(2 / 3);
    expect(result.tokenRecall).toBeCloseTo(2 / 3);
    expect(result.tokenF1).toBeCloseTo(2 / 3);
  });

  it("detects correct words in the wrong order", () => {
    const result = compareExtraction("alpha beta gamma delta", "gamma delta alpha beta");
    expect(result.tokenPrecision).toBe(1);
    expect(result.tokenRecall).toBe(1);
    expect(result.sequenceSimilarity).toBe(0.5);
  });

  it("returns finite zeroes for empty extraction", () => {
    expect(compareExtraction("alpha beta", "")).toMatchObject({
      tokenPrecision: 0,
      tokenRecall: 0,
      tokenF1: 0,
      sequenceSimilarity: 0,
      extractedTokens: 0,
    });
  });
});
