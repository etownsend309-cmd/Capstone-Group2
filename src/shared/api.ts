/**
 * The contract between the browser and the `/api` Netlify Function.
 *
 * Both sides import these types, so a field renamed on one side fails to
 * typecheck on the other. Wire values use the database's own codes
 * (`needs_review`, `reviewer`); the display labels the UI already uses live in
 * the label maps at the bottom.
 */

import type { IngestionSummary } from "./ingestion";

import type { AgreementStatus, Role } from "../types";

export const APP_ROLES = ["requester", "reviewer", "administrator"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const APP_PERMISSIONS = ["approve"] as const;
export type AppPermission = (typeof APP_PERMISSIONS)[number];

export const AGREEMENT_STATUSES = ["needs_review", "in_review", "approved", "escalated"] as const;
export type AgreementStatusCode = (typeof AGREEMENT_STATUSES)[number];

export const FINDING_DECISIONS = ["pending", "accepted", "dismissed", "escalated"] as const;
export type FindingDecisionCode = (typeof FINDING_DECISIONS)[number];

export type FindingMethodCode = "local_rule" | "manual";

export const FINDING_TYPES = ["provision", "gap"] as const;
export type FindingTypeCode = (typeof FINDING_TYPES)[number];

export const FINDING_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type FindingSeverityCode = (typeof FINDING_SEVERITIES)[number];

export const FINDING_CLASSIFICATIONS = ["present", "deviation", "uncertain", "gap"] as const;
export type FindingClassificationCode = (typeof FINDING_CLASSIFICATIONS)[number];

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  roles: AppRole[];
  permissions: AppPermission[];
}

export interface AgreementSummary {
  ingestion?: IngestionSummary;
  id: string;
  name: string;
  vendor: string;
  agreementType: string;
  businessUnit: string;
  /** YYYY-MM-DD, or null when not given. */
  neededBy: string | null;
  submittedBy: { id: string; email: string; displayName: string };
  submittedAt: string;
  status: AgreementStatusCode;
  completedAt: string | null;
  approvedAt: string | null;
  findingCount: number;
  pendingFindingCount: number;
}

/** A finding as it stood at one point in its history. */
export interface FindingSnapshot {
  category: string;
  findingType: FindingTypeCode | null;
  /** Rule-analysis result; manual flags have no automated classification. */
  classification: FindingClassificationCode | null;
  severity: FindingSeverityCode | null;
  reason: string;
  note: string;
  sourceText: string;
  playbookExpectation: string;
  decision: FindingDecisionCode;
}

export interface FindingHistoryEntry {
  action: "created" | "edited" | "decision";
  /** Who made the change, when the viewer may see that person; null otherwise. */
  actor: { email: string; displayName: string } | null;
  at: string;
  before: FindingSnapshot | null;
  after: FindingSnapshot;
}

export interface FindingRecord {
  id: string;
  category: string;
  confidence: number;
  sourceText: string;
  decision: FindingDecisionCode;
  note: string;
  method: FindingMethodCode;
  decidedAt: string | null;
  /** Provision or gap semantics for both rule findings and manual flags. */
  findingType: FindingTypeCode | null;
  /** Automated rule result; null for manual flags. */
  classification: FindingClassificationCode | null;
  severity: FindingSeverityCode | null;
  /** Why a manual flag was raised; empty for rule findings. */
  reason: string;
  /** For a gap: the playbook expectation the agreement does not meet. */
  playbookExpectation: string;
  /** Who created a manual flag, when the viewer may see that person. */
  createdBy: { email: string; displayName: string } | null;
  /** Oldest first. Rule findings have entries only once someone changes them. */
  history: FindingHistoryEntry[];
}

export interface DocumentRecord {
  id: string;
  fileName: string;
  contentType: "application/pdf" | "text/plain";
  byteSize: number;
  uploadedAt: string;
}

export interface AgreementDetail extends AgreementSummary {
  rawText: string;
  pageCount: number | null;
  extractionStrategy: string | null;
  extractionWarnings: string[];
  approvedBy: string | null;
  findings: FindingRecord[];
  documents: DocumentRecord[];
}

export interface NewAgreementInput {
  deferIngestion?: boolean;
  name: string;
  vendor: string;
  agreementType: string;
  businessUnit: string;
  /** YYYY-MM-DD, or "" when not given. */
  neededBy: string;
  rawText: string;
  pageCount?: number;
  extractionStrategy?: string;
  extractionWarnings?: string[];
}

export interface FindingDecisionInput {
  decision: FindingDecisionCode;
  note?: string;
}

/**
 * A manual flag, as created or edited. A provision cites `sourceText`, which
 * must appear exactly in the agreement, and no expectation; a gap cites no
 * text and names the `playbookExpectation` it fails.
 */
export interface ManualFindingInput {
  category: string;
  findingType: FindingTypeCode;
  severity: FindingSeverityCode;
  reason: string;
  sourceText: string;
  playbookExpectation: string;
}

/** Finding counts for one playbook category, across the agreements the person may see. */
export interface CategoryReportRow {
  category: string;
  total: number;
  accepted: number;
  escalated: number;
}

export interface CategoryReport {
  /** How many agreements the counts cover. */
  agreementCount: number;
  /** One row per approved category, in playbook order, including categories with no findings. */
  categories: CategoryReportRow[];
}

export interface ManagedUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  /** False until the person first signs in with Netlify Identity. */
  hasSignedIn: boolean;
  lastSeenAt: string | null;
  roles: AppRole[];
  permissions: AppPermission[];
}

export interface UserAccessInput {
  roles: AppRole[];
  approve: boolean;
  isActive: boolean;
}

export interface ApiErrorBody {
  error: string;
}

/** Hard limits, enforced on the server and mirrored in the browser for early feedback. */
export const LIMITS = {
  documentBytes: 25 * 1024 * 1024,
  rawTextChars: 2_000_000,
  shortTextChars: 200,
  noteChars: 4_000,
} as const;

export const STATUS_LABELS: Record<AgreementStatusCode, AgreementStatus> = {
  needs_review: "Needs review",
  in_review: "In review",
  approved: "Approved",
  escalated: "Escalated",
};

export const FINDING_TYPE_LABELS: Record<FindingTypeCode, string> = { provision: "Provision", gap: "Gap" };

export const SEVERITY_LABELS: Record<FindingSeverityCode, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const ROLE_LABELS: Record<AppRole, Role> = {
  requester: "Requester",
  reviewer: "Reviewer",
  administrator: "Administrator",
};

/**
 * The workspace views a person may switch between.
 *
 * Approver is a permission rather than a role, but the app presents it as its
 * own view because approving is a distinct job. It is offered only to someone
 * who holds the permission, which in turn requires a reviewing role.
 */
export function availableViews(user: Pick<SessionUser, "roles" | "permissions">): Role[] {
  const views: Role[] = [];
  if (user.roles.includes("requester")) views.push("Requester");
  if (user.roles.includes("reviewer") || user.roles.includes("administrator")) views.push("Reviewer");
  if (user.permissions.includes("approve")) views.push("Approver");
  if (user.roles.includes("administrator")) views.push("Administrator");
  return views;
}
