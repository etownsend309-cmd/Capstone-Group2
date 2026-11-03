import { z } from "zod";

import {
  APPROVED_CATEGORIES,
  type ClassificationRun,
  type ClassifierErrorCode,
  type ClassifyAgreementRequest,
  type ClassifyAgreementResult,
} from "../shared/classifier";
import type { Finding } from "../types";

const errorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_REQUEST",
  "AI_UNAVAILABLE",
  "AI_TIMEOUT",
  "AI_RATE_LIMITED",
  "AI_REFUSED",
  "AI_INVALID_RESPONSE",
  "INTERNAL_ERROR",
]);

const classificationRunSchema = z.object({
  id: z.string().uuid(),
  provider: z.literal("OpenAI"),
  requestedModel: z.string().min(1),
  returnedModel: z.string().optional(),
  providerResponseId: z.string().optional(),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  modelConfigVersion: z.string().min(1),
  startedAt: z.string(),
  completedAt: z.string(),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  status: z.enum(["complete", "partial", "manual_required"]),
  errorCode: errorCodeSchema.optional(),
}).strict();

const resultSchema = z.object({
  status: z.enum(["complete", "partial", "manual_required"]),
  run: classificationRunSchema,
  findings: z.array(z.object({
    category: z.enum(APPROVED_CATEGORIES),
    sourceText: z.string().min(1),
    sourceStart: z.number().int().nonnegative(),
    sourceEnd: z.number().int().positive(),
    confidenceIndicator: z.enum(["low", "medium", "high"]),
    evidenceValidation: z.literal("exact"),
  }).strict()).max(APPROVED_CATEGORIES.length),
  rejections: z.array(z.object({
    category: z.enum(APPROVED_CATEGORIES).optional(),
    reason: z.enum([
      "invalid_category",
      "duplicate_category",
      "empty_quote",
      "quote_too_long",
      "unmatched_quote",
      "ambiguous_quote",
    ]),
  }).strict()),
}).strict();

const errorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
  }).strict(),
  run: classificationRunSchema.optional(),
}).strict();

export class ClassifierRequestError extends Error {
  readonly code: ClassifierErrorCode;
  readonly run?: ClassificationRun;

  constructor(code: ClassifierErrorCode, message: string, run?: ClassificationRun) {
    super(message);
    this.name = "ClassifierRequestError";
    this.code = code;
    this.run = run;
  }
}

export async function classifyAgreement(
  request: ClassifyAgreementRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ClassifyAgreementResult> {
  const response = await fetch("/.netlify/functions/classify-agreement", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: options.signal,
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ClassifierRequestError(
      "AI_INVALID_RESPONSE",
      "The classification service returned an unreadable response.",
    );
  }

  if (!response.ok) {
    const parsedError = errorSchema.safeParse(body);
    if (!parsedError.success) {
      throw new ClassifierRequestError(
        "AI_INVALID_RESPONSE",
        "The classification service returned an invalid error response.",
      );
    }
    throw new ClassifierRequestError(
      parsedError.data.error.code,
      parsedError.data.error.message,
      parsedError.data.run,
    );
  }

  const parsedResult = resultSchema.safeParse(body);
  if (!parsedResult.success) {
    throw new ClassifierRequestError(
      "AI_INVALID_RESPONSE",
      "The classification service returned an invalid result.",
    );
  }
  return parsedResult.data;
}

export function toPendingAiFindings(result: ClassifyAgreementResult): Finding[] {
  return result.findings.map((finding) => ({
    id: crypto.randomUUID(),
    category: finding.category,
    confidenceIndicator: finding.confidenceIndicator,
    confidenceBasis: "model-self-assessment",
    sourceText: finding.sourceText,
    sourceStart: finding.sourceStart,
    sourceEnd: finding.sourceEnd,
    classificationRunId: result.run.id,
    evidenceValidation: finding.evidenceValidation,
    decision: "pending",
    note: "",
    method: "AI",
    findingType: "Provision",
  }));
}
