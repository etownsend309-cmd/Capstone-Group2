export type View = "overview" | "intake" | "review" | "reports" | "tracker";

export type Role = "Requester" | "Reviewer" | "Approver" | "Administrator";

export type FindingDecision = "pending" | "accepted" | "dismissed" | "escalated";

export type AgreementStatus =
  | "Needs review"
  | "In review"
  | "Approved"
  | "Approved with conditions"
  | "Rejected"
  | "Returned for changes"
  | "Escalated";

export interface Finding {
  id: string;
  category: string;
  confidence: number;
  sourceText: string;
  decision: FindingDecision;
  note: string;
  method: "Local rule" | "Manual";
}

export interface Agreement {
  id: string;
  name: string;
  vendor: string;
  submittedAt: string;
  submittedBy: string;
  neededBy?: string;
  currentVersion?: number;
  versions?: AgreementVersion[];
  conditions?: string[];
  status: AgreementStatus;
  rawText: string;
  pageCount?: number;
  extractionStrategy?: string;
  extractionWarnings?: string[];
  findings: Finding[];
  completedAt?: string;
}

export interface AgreementVersion {
  version: number;
  fileName: string;
  uploadedAt: string;
}

export interface RequesterSubmission {
  id: string;
  name: string;
  vendor: string;
  submittedAt: string;
  neededBy?: string;
  status: AgreementStatus;
  currentVersion?: number;
  versions: AgreementVersion[];
  completedAt?: string;
  conditions: string[];
}
