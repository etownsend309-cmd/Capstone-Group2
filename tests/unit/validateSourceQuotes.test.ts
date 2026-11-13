import { describe, expect, it } from "vitest";

import type { ModelFindingV1 } from "../../src/shared/classifier";
import { validateSourceQuotes } from "../../netlify/functions/_shared/validateSourceQuotes";
import { MAX_QUOTE_CHARACTERS } from "../../netlify/functions/_shared/classifierSchema";

const finding = (patch: Partial<ModelFindingV1> = {}): ModelFindingV1 => ({
  category: "Governing Law",
  quote: "governed by the laws of Georgia",
  leftContext: null,
  rightContext: null,
  confidenceIndicator: "high",
  ...patch,
});

describe("validateSourceQuotes", () => {
  it("calculates exact UTF-16 offsets for a unique quote", () => {
    const text = "This agreement is governed by the laws of Georgia.";
    const result = validateSourceQuotes(text, [finding()]);
    expect(result.rejections).toEqual([]);
    expect(result.findings[0]).toMatchObject({
      sourceStart: 18,
      sourceEnd: 49,
      sourceText: "governed by the laws of Georgia",
      evidenceValidation: "exact",
    });
    expect(text.slice(result.findings[0].sourceStart, result.findings[0].sourceEnd)).toBe(
      result.findings[0].sourceText,
    );
  });

  it("uses exact adjacent context to disambiguate a repeated quote", () => {
    const quote = "written notice";
    const text = `First ${quote} is optional. Second ${quote} is required.`;
    const result = validateSourceQuotes(text, [
      finding({ quote, leftContext: "Second ", rightContext: " is required." }),
    ]);
    expect(result.rejections).toEqual([]);
    expect(result.findings[0].sourceStart).toBe(text.lastIndexOf(quote));
  });

  it("rejects a repeated quote when context does not select one occurrence", () => {
    const quote = "written notice";
    const result = validateSourceQuotes(`${quote}; ${quote}`, [finding({ quote })]);
    expect(result.findings).toEqual([]);
    expect(result.rejections).toEqual([
      { category: "Governing Law", reason: "ambiguous_quote" },
    ]);
  });

  it("rejects normalized or paraphrased text instead of repairing it", () => {
    const result = validateSourceQuotes("governed  by the laws of Georgia", [finding()]);
    expect(result.findings).toEqual([]);
    expect(result.rejections[0]?.reason).toBe("unmatched_quote");
  });

  it("rejects every finding for a duplicate category", () => {
    const text = "governed by the laws of Georgia and governed by New York law";
    const result = validateSourceQuotes(text, [
      finding(),
      finding({ quote: "governed by New York law", confidenceIndicator: "medium" }),
    ]);
    expect(result.findings).toEqual([]);
    expect(result.rejections).toEqual([
      { category: "Governing Law", reason: "duplicate_category" },
    ]);
  });

  it("keeps valid findings when another finding is rejected", () => {
    const text = "This agreement is governed by the laws of Georgia.";
    const result = validateSourceQuotes(text, [
      finding(),
      finding({ category: "Insurance", quote: "commercial general liability" }),
    ]);
    expect(result.findings).toHaveLength(1);
    expect(result.rejections).toEqual([
      { category: "Insurance", reason: "unmatched_quote" },
    ]);
  });

  it("rejects empty and over-length quotes before searching the document", () => {
    expect(validateSourceQuotes("contract", [finding({ quote: "   " })]).rejections).toEqual([
      { category: "Governing Law", reason: "empty_quote" },
    ]);
    expect(validateSourceQuotes("contract", [
      finding({ quote: "x".repeat(MAX_QUOTE_CHARACTERS + 1) }),
    ]).rejections).toEqual([
      { category: "Governing Law", reason: "quote_too_long" },
    ]);
  });

  it("defensively rejects a category outside the approved allowlist", () => {
    const invalid = {
      ...finding(),
      category: "Payment Terms",
    } as unknown as ModelFindingV1;
    expect(validateSourceQuotes("net 30", [invalid])).toEqual({
      findings: [],
      rejections: [{ reason: "invalid_category" }],
    });
  });
});
