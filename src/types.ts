import type { ConfidenceIndicator } from "./shared/classifier";

export type View = "overview" | "tracker" | "intake" | "review" | "reports" | "users";

export type Role = "Requester" | "Reviewer" | "Approver" | "Administrator";

export type FindingDecision = "pending" | "accepted" | "dismissed" | "escalated";
export type FindingType = "Provision" | "Gap";
export type FindingSeverity = "Low" | "Medium" | "High" | "Critical";
export type FindingClassification = "present" | "deviation" | "uncertain" | "gap";

export type AgreementStatus =
  | "Needs review"
  | "In review"
  | "Approved"
  | "Escalated";

/**
 * A finding as the playbook rules or the classifier produce it before it is
 * stored. Saved agreements use `FindingRecord` in `src/shared/api.ts`.
 */
export interface Finding {
  id: string;
  category: string;
  /** Legacy numeric indicator used by the local-rule prototype. */
  confidence: number;
  confidenceIndicator?: ConfidenceIndicator;
  confidenceBasis?: "model-self-assessment" | "prototype-rule" | "manual";
  sourceText: string;
  sourceStart?: number;
  sourceEnd?: number;
  classificationRunId?: string;
  evidenceValidation?: "exact";
  decision: FindingDecision;
  note: string;
  method: "AI" | "Local rule" | "Manual";
  findingType?: FindingType;
  classification?: FindingClassification;
  severity?: FindingSeverity;
  reason?: string;
  playbookExpectation?: string;
  history?: unknown[];
}
