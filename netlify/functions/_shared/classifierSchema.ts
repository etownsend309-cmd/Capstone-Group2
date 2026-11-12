import { z } from "zod";

import { APPROVED_CATEGORIES } from "../../../src/shared/classifier.js";

export const MAX_DOCUMENT_CHARACTERS = 1_500_000;
export const MAX_QUOTE_CHARACTERS = 8_000;
export const MAX_CONTEXT_CHARACTERS = 300;

export const classifyAgreementRequestSchema = z.object({
  agreementId: z.string().uuid(),
  documentText: z.string().trim().min(1).max(MAX_DOCUMENT_CHARACTERS),
  extraction: z.object({
    strategy: z.string().max(100).optional(),
    pageCount: z.number().int().nonnegative().optional(),
  }).strict(),
}).strict();

export const modelFindingSchema = z.object({
  category: z.enum(APPROVED_CATEGORIES),
  quote: z.string().min(1).max(MAX_QUOTE_CHARACTERS),
  leftContext: z.string().max(MAX_CONTEXT_CHARACTERS).nullable(),
  rightContext: z.string().max(MAX_CONTEXT_CHARACTERS).nullable(),
  confidenceIndicator: z.enum(["low", "medium", "high"]),
}).strict();

export const modelClassifierOutputSchema = z.object({
  findings: z.array(modelFindingSchema).max(APPROVED_CATEGORIES.length),
}).strict();

export type ParsedModelClassifierOutput = z.infer<typeof modelClassifierOutputSchema>;
