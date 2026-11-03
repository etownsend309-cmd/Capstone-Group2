export type View = "overview" | "tracker" | "intake" | "review" | "reports" | "users";

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

/** A rule-based finding as the playbook rules produce it (see src/lib/analyze.ts). */
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
