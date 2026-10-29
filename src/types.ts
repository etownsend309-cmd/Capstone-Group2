export type View = "overview" | "tracker" | "intake" | "review" | "reports";

export type Role = "Requester" | "Reviewer" | "Approver" | "Administrator";

export type FindingDecision = "pending" | "accepted" | "dismissed" | "escalated";
export type FindingType = "Provision" | "Gap";
export type FindingSeverity = "Low" | "Medium" | "High" | "Critical";

export interface FindingAuditSnapshot {
  category: string;
  findingType?: FindingType;
  severity?: FindingSeverity;
  reason?: string;
  note?: string;
  sourceText: string;
  playbookExpectation?: string;
  decision: FindingDecision;
}


export interface FindingAuditEntry {
  action: "created" | "edited" | "decision";
  actor: string;
  at: string;
  before?: FindingAuditSnapshot;
  after: FindingAuditSnapshot;
}

export type AgreementStatus =
  | "Needs review"
  | "In review"
  | "Approved"
  | "Escalated";

export interface Finding {
  id: string;
  category: string;
  confidence: number;
  sourceText: string;
  decision: FindingDecision;
  note: string;
  method: "Local rule" | "Manual";
  findingType?: FindingType;
  severity?: FindingSeverity;
  reason?: string;
  creator?: string;
  playbookExpectation?: string;
  history?: FindingAuditEntry[];
}

export interface Agreement {
  id: string;
  name: string;
  vendor: string;
  agreementType: string;
  businessUnit: string;
  /** Calendar date in YYYY-MM-DD format; empty for legacy prototype records. */
  neededBy: string;
  submittedAt: string;
  submittedBy: string;
  status: AgreementStatus;
  rawText: string;
  pageCount?: number;
  /** Which PDF.js reconstruction strategy produced `rawText`, for traceability. */
  extractionStrategy?: string;
  /** Non-fatal extraction notes, e.g. a low-text warning on a sparse document. */
  extractionWarnings?: string[];
  findings: Finding[];
  completedAt?: string;
}
