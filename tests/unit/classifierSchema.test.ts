import { describe, expect, it } from "vitest";

import {
  classifyAgreementRequestSchema,
  modelClassifierOutputSchema,
} from "../../netlify/functions/_shared/classifierSchema";

describe("classifier schemas", () => {
  it("accepts the strict v1 model response", () => {
    expect(modelClassifierOutputSchema.safeParse({
      findings: [{
        category: "Governing Law",
        quote: "governed by the laws of Georgia",
        leftContext: null,
        rightContext: ".",
        confidenceIndicator: "high",
      }],
    }).success).toBe(true);
  });

  it("rejects unknown categories, confidence values, and extra fields", () => {
    expect(modelClassifierOutputSchema.safeParse({
      findings: [{
        category: "Payment Terms",
        quote: "net 30",
        leftContext: null,
        rightContext: null,
        confidenceIndicator: 0.92,
        rationale: "Looks right",
      }],
    }).success).toBe(false);
  });

  it("rejects more than one result per approved category slot", () => {
    const repeated = Array.from({ length: 13 }, () => ({
      category: "Governing Law",
      quote: "governed by law",
      leftContext: null,
      rightContext: null,
      confidenceIndicator: "low",
    }));
    expect(modelClassifierOutputSchema.safeParse({ findings: repeated }).success).toBe(false);
  });

  it("validates request IDs, nonempty text, and extraction metadata", () => {
    expect(classifyAgreementRequestSchema.safeParse({
      agreementId: "b18fa174-6759-4d6a-99b1-c28e5b960bd5",
      documentText: "Agreement text",
      extraction: { strategy: "coordinate-order", pageCount: 2 },
    }).success).toBe(true);
    expect(classifyAgreementRequestSchema.safeParse({
      agreementId: "not-an-id",
      documentText: " ",
      extraction: {},
    }).success).toBe(false);
  });
});
