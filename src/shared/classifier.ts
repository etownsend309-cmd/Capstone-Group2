export const APPROVED_CATEGORIES = [
  "Governing Law",
  "Anti-Assignment",
  "Cap On Liability",
  "Audit Rights",
  "Termination For Convenience",
  "Exclusivity",
  "Renewal Term",
  "Insurance",
  "Change Of Control",
  "Uncapped Liability",
  "Notice Period To Terminate Renewal",
  "Warranty Duration",
] as const;

export type ApprovedCategory = (typeof APPROVED_CATEGORIES)[number];
export type ConfidenceIndicator = "low" | "medium" | "high";
export type ClassificationStatus =
  | "not_started"
  | "classifying"
  | "complete"
  | "partial"
  | "manual_required";

export type RejectionReason =
  | "invalid_category"
  | "duplicate_category"
  | "empty_quote"
  | "quote_too_long"
  | "unmatched_quote"
  | "ambiguous_quote";

export type ClassifierErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "AI_UNAVAILABLE"
  | "AI_TIMEOUT"
  | "AI_RATE_LIMITED"
  | "AI_REFUSED"
  | "AI_INVALID_RESPONSE"
  | "INTERNAL_ERROR";

export interface ClassifyAgreementRequest {
  agreementId: string;
  documentText: string;
  extraction: {
    strategy?: string;
    pageCount?: number;
  };
}

export interface ModelFindingV1 {
  category: ApprovedCategory;
  quote: string;
  leftContext: string | null;
  rightContext: string | null;
  confidenceIndicator: ConfidenceIndicator;
}

export interface ModelClassifierOutputV1 {
  findings: ModelFindingV1[];
}

export interface ValidatedAiFinding {
  category: ApprovedCategory;
  sourceText: string;
  sourceStart: number;
  sourceEnd: number;
  confidenceIndicator: ConfidenceIndicator;
  evidenceValidation: "exact";
}

export interface FindingRejection {
  category?: ApprovedCategory;
  reason: RejectionReason;
}

export interface ClassificationRun {
  id: string;
  provider: "OpenAI";
  requestedModel: string;
  returnedModel?: string;
  providerResponseId?: string;
  promptVersion: string;
  schemaVersion: string;
  modelConfigVersion: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  status: Exclude<ClassificationStatus, "not_started" | "classifying">;
  errorCode?: ClassifierErrorCode;
}

export interface ClassifyAgreementResult {
  status: "complete" | "partial" | "manual_required";
  run: ClassificationRun;
  findings: ValidatedAiFinding[];
  rejections: FindingRejection[];
}

export interface ClassifierApiError {
  error: {
    code: ClassifierErrorCode;
    message: string;
  };
  run?: ClassificationRun;
}

export const PROMPT_VERSION = "clausepilot-classifier-v1";
export const SCHEMA_VERSION = "classifier-output-v1";
export const MODEL_CONFIG_VERSION = "openai-terra-low-v1";
