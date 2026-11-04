/**
 * Agreements and their findings.
 *
 * Every function takes a `Queryable` already scoped to the signed-in user (see
 * server/db.ts), so row-level security decides visibility. The checks here
 * exist to give clear errors and to keep workflow rules in one readable place;
 * the database enforces the same rules again underneath.
 */

import { analyzeAgreement, playbook } from "../../src/lib/analyze.ts";
import { normalizeManualFinding, validateManualFinding } from "../../src/lib/manualFinding.ts";
import {
  FINDING_DECISIONS,
  FINDING_SEVERITIES,
  FINDING_TYPES,
  LIMITS,
  type AgreementDetail,
  type AgreementStatusCode,
  type AgreementSummary,
  type CategoryReport,
  type DocumentRecord,
  type FindingDecisionCode,
  type FindingDecisionInput,
  type FindingClassificationCode,
  type FindingHistoryEntry,
  type FindingRecord,
  type FindingSeverityCode,
  type FindingSnapshot,
  type FindingTypeCode,
  type ManualFindingInput,
  type NewAgreementInput,
} from "../../src/shared/api.ts";
import { isUuid, type Queryable } from "../db.ts";
import { badRequest, conflict, forbidden, notFound } from "../errors.ts";
import { recordAudit } from "./audit.ts";

const CATEGORY_NAMES = new Set(playbook.map((category) => category.name));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface SummaryRow {
  id: string;
  name: string;
  vendor: string;
  agreement_type: string;
  business_unit: string;
  needed_by: string | null;
  submitted_by: string;
  submitter_email: string | null;
  submitter_name: string | null;
  submitted_at: Date;
  status: AgreementStatusCode;
  completed_at: Date | null;
  approved_at: Date | null;
  finding_count: number;
  pending_finding_count: number;
}

interface DetailRow extends SummaryRow {
  raw_text: string;
  page_count: number | null;
  extraction_strategy: string | null;
  extraction_warnings: string[];
  approved_by: string | null;
}

interface FindingRow {
  id: string;
  agreement_id: string;
  category: string;
  confidence: string;
  source_text: string;
  decision: FindingDecisionCode;
  note: string;
  method: "local_rule" | "manual";
  decided_at: Date | null;
  finding_type: FindingTypeCode | null;
  classification: FindingClassificationCode | null;
  severity: FindingSeverityCode | null;
  reason: string;
  playbook_expectation: string;
  creator_email: string | null;
  creator_name: string | null;
}

interface HistoryRow {
  action: string;
  detail: { findingId?: string; before?: FindingSnapshot; after?: FindingSnapshot };
  created_at: Date;
  actor_email: string | null;
  actor_name: string | null;
}

// The creator's name comes through a LEFT JOIN: row-level security shows
// requesters only their own account, so for them other people's names are null.
const FINDING_COLUMNS = `
  f.id, f.agreement_id, f.category, f.confidence, f.source_text, f.decision, f.note, f.method,
  f.decided_at, f.finding_type, f.classification, f.severity, f.reason, f.playbook_expectation,
  c.email AS creator_email, c.display_name AS creator_name`;
const FINDING_FROM = "findings f LEFT JOIN app_users c ON c.id = f.created_by";

const HISTORY_ACTIONS: Record<string, FindingHistoryEntry["action"]> = {
  "finding.added": "created",
  "finding.edited": "edited",
  "finding.decided": "decision",
};

interface DocumentRow {
  id: string;
  file_name: string;
  content_type: DocumentRecord["contentType"];
  byte_size: string;
  uploaded_at: Date;
}

// `needed_by::text` keeps dates as YYYY-MM-DD instead of a timezone-shifted Date.
// The submitter's name comes through a LEFT JOIN because requesters may only
// read their own app_users row; for their own agreements that is always them.
const SUMMARY_COLUMNS = `
  a.id, a.name, a.vendor, a.agreement_type, a.business_unit, a.needed_by::text AS needed_by,
  a.submitted_by, u.email AS submitter_email, u.display_name AS submitter_name,
  a.submitted_at, a.status, a.completed_at, a.approved_at,
  (SELECT count(*)::int FROM findings f WHERE f.agreement_id = a.id) AS finding_count,
  (SELECT count(*)::int FROM findings f WHERE f.agreement_id = a.id AND f.decision = 'pending') AS pending_finding_count`;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

function toSummary(row: SummaryRow): AgreementSummary {
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    agreementType: row.agreement_type,
    businessUnit: row.business_unit,
    neededBy: row.needed_by,
    submittedBy: {
      id: row.submitted_by,
      email: row.submitter_email ?? "",
      displayName: row.submitter_name ?? "",
    },
    submittedAt: row.submitted_at.toISOString(),
    status: row.status,
    completedAt: iso(row.completed_at),
    approvedAt: iso(row.approved_at),
    findingCount: row.finding_count,
    pendingFindingCount: row.pending_finding_count,
  };
}

function toFinding(row: FindingRow, history: FindingHistoryEntry[] = []): FindingRecord {
  return {
    id: row.id,
    category: row.category,
    confidence: Number(row.confidence),
    sourceText: row.source_text,
    decision: row.decision,
    note: row.note,
    method: row.method,
    decidedAt: iso(row.decided_at),
    findingType: row.finding_type,
    classification: row.classification,
    severity: row.severity,
    reason: row.reason,
    playbookExpectation: row.playbook_expectation,
    createdBy:
      row.method === "manual" && row.creator_email
        ? { email: row.creator_email, displayName: row.creator_name ?? "" }
        : null,
    history,
  };
}

function snapshot(row: FindingRow): FindingSnapshot {
  return {
    category: row.category,
    findingType: row.finding_type,
    classification: row.classification,
    severity: row.severity,
    reason: row.reason,
    note: row.note,
    sourceText: row.source_text,
    playbookExpectation: row.playbook_expectation,
    decision: row.decision,
  };
}

const sameSnapshot = (a: FindingSnapshot, b: FindingSnapshot) =>
  (Object.keys(a) as (keyof FindingSnapshot)[]).every((key) => a[key] === b[key]);

async function loadFinding(db: Queryable, findingId: string): Promise<FindingRow> {
  if (!isUuid(findingId)) throw notFound("That finding");
  const { rows } = await db.query<FindingRow>(`SELECT ${FINDING_COLUMNS} FROM ${FINDING_FROM} WHERE f.id = $1`, [findingId]);
  if (!rows[0]) throw notFound("That finding");
  return rows[0];
}

/**
 * Each finding's history, from the audit trail. Only events that carry a
 * snapshot are history entries; older events without one are left out.
 */
async function findingHistory(db: Queryable, agreementId: string): Promise<Map<string, FindingHistoryEntry[]>> {
  const { rows } = await db.query<HistoryRow>(
    `SELECT e.action, e.detail, e.created_at, u.email AS actor_email, u.display_name AS actor_name
       FROM audit_events e LEFT JOIN app_users u ON u.id = e.actor_id
      WHERE e.agreement_id = $1 AND e.action = ANY($2) AND e.detail ? 'after'
      ORDER BY e.created_at, e.id`,
    [agreementId, Object.keys(HISTORY_ACTIONS)],
  );
  const byFinding = new Map<string, FindingHistoryEntry[]>();
  for (const row of rows) {
    const { findingId, before, after } = row.detail;
    if (!findingId || !after) continue;
    const entries = byFinding.get(findingId) ?? [];
    entries.push({
      action: HISTORY_ACTIONS[row.action]!,
      actor: row.actor_email ? { email: row.actor_email, displayName: row.actor_name ?? "" } : null,
      at: row.created_at.toISOString(),
      before: before ?? null,
      after,
    });
    byFinding.set(findingId, entries);
  }
  return byFinding;
}

export async function listAgreements(db: Queryable): Promise<AgreementSummary[]> {
  const { rows } = await db.query<SummaryRow>(
    `SELECT ${SUMMARY_COLUMNS}
       FROM agreements a LEFT JOIN app_users u ON u.id = a.submitted_by
      ORDER BY a.submitted_at DESC`,
  );
  return rows.map(toSummary);
}

/**
 * Finding counts per playbook category. Row-level security limits both
 * queries to the agreements this person may see, so a requester's report
 * covers only their own submissions.
 */
export async function categoryReport(db: Queryable): Promise<CategoryReport> {
  const agreements = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM agreements");
  const { rows } = await db.query<{ category: string; total: number; accepted: number; escalated: number }>(
    `SELECT f.category,
            count(*)::int AS total,
            count(*) FILTER (WHERE f.decision = 'accepted')::int AS accepted,
            count(*) FILTER (WHERE f.decision = 'escalated')::int AS escalated
       FROM findings f JOIN agreements a ON a.id = f.agreement_id
      GROUP BY f.category`,
  );
  const byCategory = new Map(rows.map((row) => [row.category, row]));
  return {
    agreementCount: agreements.rows[0]?.count ?? 0,
    categories: playbook.map(({ name }) => {
      const row = byCategory.get(name);
      return { category: name, total: row?.total ?? 0, accepted: row?.accepted ?? 0, escalated: row?.escalated ?? 0 };
    }),
  };
}

export async function getAgreement(db: Queryable, id: string): Promise<AgreementDetail> {
  if (!isUuid(id)) throw notFound("That agreement");

  const { rows } = await db.query<DetailRow>(
    `SELECT ${SUMMARY_COLUMNS}, a.raw_text, a.page_count, a.extraction_strategy,
            a.extraction_warnings, a.approved_by
       FROM agreements a LEFT JOIN app_users u ON u.id = a.submitted_by
      WHERE a.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound("That agreement");

  const findings = await db.query<FindingRow>(
    `SELECT ${FINDING_COLUMNS} FROM ${FINDING_FROM} WHERE f.agreement_id = $1 ORDER BY f.created_at, f.category`,
    [id],
  );
  const history = await findingHistory(db, id);
  const documents = await db.query<DocumentRow>(
    `SELECT id, file_name, content_type, byte_size, uploaded_at
       FROM agreement_documents WHERE agreement_id = $1 ORDER BY uploaded_at`,
    [id],
  );

  return {
    ...toSummary(row),
    rawText: row.raw_text,
    pageCount: row.page_count,
    extractionStrategy: row.extraction_strategy,
    extractionWarnings: row.extraction_warnings,
    approvedBy: row.approved_by,
    findings: findings.rows.map((finding) => toFinding(finding, history.get(finding.id))),
    documents: documents.rows.map((doc) => ({
      id: doc.id,
      fileName: doc.file_name,
      contentType: doc.content_type,
      byteSize: Number(doc.byte_size),
      uploadedAt: doc.uploaded_at.toISOString(),
    })),
  };
}

function requiredText(value: unknown, label: string, max: number = LIMITS.shortTextChars): string {
  if (typeof value !== "string" || value.trim() === "") throw badRequest(`${label} is required.`);
  if (value.length > max) throw badRequest(`${label} is too long.`);
  return value.trim();
}

function optionalText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw badRequest(`${label} must be text.`);
  if (value.length > max) throw badRequest(`${label} is too long.`);
  return value.trim();
}

export function parseNewAgreement(body: unknown): NewAgreementInput {
  if (typeof body !== "object" || body === null) throw badRequest("Send the agreement details as JSON.");
  const input = body as Record<string, unknown>;

  const neededBy = optionalText(input.neededBy, "Needed by", 10);
  if (neededBy && !ISO_DATE.test(neededBy)) throw badRequest("Needed by must be a date (YYYY-MM-DD).");

  const rawText = optionalText(input.rawText, "Agreement text", LIMITS.rawTextChars);
  if (!rawText) throw badRequest("The agreement has no readable text.");

  const pageCount = input.pageCount;
  if (pageCount !== undefined && (!Number.isInteger(pageCount) || (pageCount as number) < 1)) {
    throw badRequest("Page count must be a positive whole number.");
  }

  const warnings = input.extractionWarnings ?? [];
  if (!Array.isArray(warnings) || warnings.some((w) => typeof w !== "string" || w.length > 500) || warnings.length > 20) {
    throw badRequest("Extraction warnings must be a short list of text.");
  }

  return {
    name: requiredText(input.name, "Agreement name"),
    vendor: requiredText(input.vendor, "Vendor"),
    agreementType: requiredText(input.agreementType, "Agreement type"),
    businessUnit: requiredText(input.businessUnit, "Business unit"),
    neededBy,
    rawText,
    pageCount: pageCount as number | undefined,
    extractionStrategy: optionalText(input.extractionStrategy, "Extraction strategy", LIMITS.shortTextChars) || undefined,
    extractionWarnings: warnings as string[],
  };
}

/**
 * Submits an agreement as the signed-in user. Findings are produced here, by
 * the same deterministic rules the browser runs, rather than accepted from the
 * request: a requester cannot hand in pre-made findings.
 */
export async function submitAgreement(db: Queryable, userId: string, input: NewAgreementInput): Promise<AgreementDetail> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO agreements (
       name, vendor, agreement_type, business_unit, needed_by, submitted_by,
       raw_text, page_count, extraction_strategy, extraction_warnings)
     VALUES ($1, $2, $3, $4, NULLIF($5, '')::date, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      input.name,
      input.vendor,
      input.agreementType,
      input.businessUnit,
      input.neededBy,
      userId,
      input.rawText,
      input.pageCount ?? null,
      input.extractionStrategy ?? null,
      input.extractionWarnings ?? [],
    ],
  );
  const id = rows[0]!.id;

  for (const finding of analyzeAgreement(input.rawText)) {
    await db.query(
      `INSERT INTO findings (
         agreement_id, category, confidence, source_text, method,
         finding_type, classification, severity, reason, playbook_expectation)
       VALUES ($1, $2, $3, $4, 'local_rule', $5, $6, $7, $8, $9)`,
      [
        id,
        finding.category,
        finding.confidence,
        finding.sourceText,
        finding.findingType?.toLowerCase(),
        finding.classification,
        finding.severity?.toLowerCase(),
        finding.reason,
        finding.playbookExpectation,
      ],
    );
  }

  await recordAudit(db, userId, id, "agreement.submitted");
  return getAgreement(db, id);
}

interface LockedAgreement {
  status: AgreementStatusCode;
  submitted_by: string;
  raw_text: string;
}

async function lockAgreement(db: Queryable, id: string): Promise<LockedAgreement> {
  if (!isUuid(id)) throw notFound("That agreement");
  const { rows } = await db.query<LockedAgreement>(
    "SELECT status, submitted_by, raw_text FROM agreements WHERE id = $1 FOR UPDATE",
    [id],
  );
  if (rows[0]) return rows[0];

  // FOR UPDATE also applies the UPDATE policy, so a requester looking at their
  // own agreement gets no row here. Tell "can't see it" from "can't change it".
  const visible = await db.query("SELECT 1 FROM agreements WHERE id = $1", [id]);
  if (visible.rowCount) throw forbidden("Only reviewers can change an agreement under review.");
  throw notFound("That agreement");
}

/**
 * The checks every review action shares: the review is still open, and the
 * person acting did not submit the agreement. Reviewing your own submission
 * is refused even with the Reviewer or Administrator role.
 */
function assertCanReview(agreement: LockedAgreement, userId: string) {
  if (agreement.status === "approved" || agreement.status === "escalated") {
    throw conflict("This review is already complete.");
  }
  if (agreement.submitted_by === userId) {
    throw forbidden("You cannot review your own agreement. Ask another reviewer to decide it.");
  }
}

/** A reviewer touching a new agreement moves it into review. */
async function markInReview(db: Queryable, id: string, status: AgreementStatusCode) {
  if (status === "needs_review") {
    await db.query("UPDATE agreements SET status = 'in_review' WHERE id = $1", [id]);
  }
}

export function parseDecision(body: unknown): FindingDecisionInput {
  const input = (body ?? {}) as Record<string, unknown>;
  if (!FINDING_DECISIONS.includes(input.decision as FindingDecisionCode)) {
    throw badRequest(`Decision must be one of: ${FINDING_DECISIONS.join(", ")}.`);
  }
  return {
    decision: input.decision as FindingDecisionCode,
    note: input.note === undefined ? undefined : optionalText(input.note, "Note", LIMITS.noteChars),
  };
}

export async function decideFinding(
  db: Queryable,
  userId: string,
  findingId: string,
  input: FindingDecisionInput,
): Promise<AgreementDetail> {
  const current = await loadFinding(db, findingId);
  const agreement = await lockAgreement(db, current.agreement_id);
  assertCanReview(agreement, userId);

  const note = input.note ?? current.note;
  if (input.decision !== "pending" && !note.trim()) {
    throw badRequest("Add a reason before accepting, dismissing, or escalating this flag.");
  }
  const before = snapshot(current);
  const after: FindingSnapshot = { ...before, decision: input.decision, note };
  if (sameSnapshot(before, after)) return getAgreement(db, current.agreement_id);

  const updated = await db.query(
    "UPDATE findings SET decision = $2, note = $3 WHERE id = $1",
    [findingId, input.decision, note],
  );
  if (!updated.rowCount) throw forbidden("Only reviewers can record decisions.");

  await markInReview(db, current.agreement_id, agreement.status);
  const action = after.decision !== before.decision ? "finding.decided" : "finding.edited";
  await recordAudit(db, userId, current.agreement_id, action, { findingId, decision: input.decision, before, after });
  return getAgreement(db, current.agreement_id);
}

export function parseManualFinding(body: unknown): ManualFindingInput {
  const input = (body ?? {}) as Record<string, unknown>;
  const category = requiredText(input.category, "Category");
  if (!CATEGORY_NAMES.has(category)) throw badRequest("That isn't one of the 12 approved categories.");
  if (!FINDING_TYPES.includes(input.findingType as FindingTypeCode)) {
    throw badRequest(`Finding type must be one of: ${FINDING_TYPES.join(", ")}.`);
  }
  if (!FINDING_SEVERITIES.includes(input.severity as FindingSeverityCode)) {
    throw badRequest(`Severity must be one of: ${FINDING_SEVERITIES.join(", ")}.`);
  }
  return {
    category,
    findingType: input.findingType as FindingTypeCode,
    severity: input.severity as FindingSeverityCode,
    reason: requiredText(input.reason, "Reason", LIMITS.noteChars),
    // Not trimmed: a provision's text must match the agreement exactly.
    sourceText: optionalRawText(input.sourceText, "Source text", LIMITS.noteChars),
    playbookExpectation: optionalText(input.playbookExpectation, "Playbook expectation", LIMITS.noteChars),
  };
}

function optionalRawText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw badRequest(`${label} must be text.`);
  if (value.length > max) throw badRequest(`${label} is too long.`);
  return value;
}

/** Applies the same rules the review screen shows, against the agreement's own text. */
function checkManualFinding(input: ManualFindingInput, agreementText: string): ManualFindingInput {
  const errors = Object.values(validateManualFinding(input, agreementText));
  if (errors.length) throw badRequest(errors[0]!);
  return normalizeManualFinding(input);
}

export async function addManualFinding(
  db: Queryable,
  userId: string,
  agreementId: string,
  input: ManualFindingInput,
): Promise<AgreementDetail> {
  const agreement = await lockAgreement(db, agreementId);
  assertCanReview(agreement, userId);
  const flag = checkManualFinding(input, agreement.raw_text);

  // The reason doubles as the first reviewer note, so a decision can follow at once.
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO findings (
       agreement_id, category, confidence, source_text, note, method,
       finding_type, severity, reason, playbook_expectation)
     VALUES ($1, $2, 1, $3, $4, 'manual', $5, $6, $4, $7)
     RETURNING id`,
    [agreementId, flag.category, flag.sourceText, flag.reason, flag.findingType, flag.severity, flag.playbookExpectation],
  );
  const created = await loadFinding(db, rows[0]!.id);
  await markInReview(db, agreementId, agreement.status);
  await recordAudit(db, userId, agreementId, "finding.added", {
    findingId: created.id,
    category: flag.category,
    after: snapshot(created),
  });
  return getAgreement(db, agreementId);
}

/** Edits a manual flag. Rule findings come from the playbook and are not editable. */
export async function editManualFinding(
  db: Queryable,
  userId: string,
  findingId: string,
  input: ManualFindingInput,
): Promise<AgreementDetail> {
  const current = await loadFinding(db, findingId);
  if (current.method !== "manual") throw badRequest("Only manual flags can be edited.");
  const agreement = await lockAgreement(db, current.agreement_id);
  assertCanReview(agreement, userId);
  const flag = checkManualFinding(input, agreement.raw_text);

  const before = snapshot(current);
  const after: FindingSnapshot = {
    ...before,
    category: flag.category,
    findingType: flag.findingType,
    severity: flag.severity,
    reason: flag.reason,
    note: flag.reason,
    sourceText: flag.sourceText,
    playbookExpectation: flag.playbookExpectation,
  };
  if (sameSnapshot(before, after)) return getAgreement(db, current.agreement_id);

  const updated = await db.query(
    `UPDATE findings
        SET category = $2, finding_type = $3, severity = $4, reason = $5, note = $5,
            source_text = $6, playbook_expectation = $7
      WHERE id = $1`,
    [findingId, after.category, after.findingType, after.severity, after.reason, after.sourceText, after.playbookExpectation],
  );
  if (!updated.rowCount) throw forbidden("Only reviewers can edit flags.");

  await markInReview(db, current.agreement_id, agreement.status);
  await recordAudit(db, userId, current.agreement_id, "finding.edited", { findingId, before, after });
  return getAgreement(db, current.agreement_id);
}

/**
 * Completes a review. With any escalated finding the agreement is escalated,
 * which any reviewer may do; otherwise it is approved, which needs the
 * Approver permission (the database trigger refuses it without).
 */
export async function completeReview(db: Queryable, userId: string, agreementId: string): Promise<AgreementDetail> {
  const agreement = await lockAgreement(db, agreementId);
  assertCanReview(agreement, userId);

  const { rows } = await db.query<{ pending: number; escalated: number }>(
    `SELECT count(*) FILTER (WHERE decision = 'pending')::int AS pending,
            count(*) FILTER (WHERE decision = 'escalated')::int AS escalated
       FROM findings WHERE agreement_id = $1`,
    [agreementId],
  );
  const counts = rows[0] ?? { pending: 0, escalated: 0 };
  if (counts.pending > 0) throw conflict("Record a decision on every finding before completing the review.");

  const outcome: AgreementStatusCode = counts.escalated > 0 ? "escalated" : "approved";
  const updated = await db.query("UPDATE agreements SET status = $2 WHERE id = $1", [agreementId, outcome]);
  if (!updated.rowCount) throw forbidden("Only reviewers can complete a review.");

  await recordAudit(db, userId, agreementId, outcome === "approved" ? "agreement.approved" : "agreement.escalated");
  return getAgreement(db, agreementId);
}
