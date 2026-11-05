/**
 * An in-memory stand-in for the browser API client (src/lib/api.ts), for
 * component tests.
 *
 * It follows the server's workflow rules closely enough for the screens:
 * findings come from the same playbook rules on submit, a decision needs a
 * reason and moves a new agreement into review, nobody reviews their own
 * agreement, manual flags are validated and keep a history, and completing a
 * review approves or escalates it. Role-based access control is not
 * modelled; tests/integration covers that against the real handler and
 * database. Every method is a `vi.fn`, so tests can assert
 * calls or make one fail.
 */

import { vi } from "vitest";

import { analyzeAgreement, playbook } from "../../../src/lib/analyze";
import { normalizeManualFinding, validateManualFinding } from "../../../src/lib/manualFinding";
import type {
  AgreementDetail,
  AgreementSummary,
  CategoryReport,
  DocumentRecord,
  FindingDecisionInput,
  FindingHistoryEntry,
  FindingRecord,
  FindingSnapshot,
  ManagedUser,
  ManualFindingInput,
  NewAgreementInput,
  UserAccessInput,
} from "../../../src/shared/api";

// The real error class, not the mocked module, since tests mock src/lib/api with this file.
const { ApiRequestError } = await vi.importActual<typeof import("../../../src/lib/api")>("../../../src/lib/api");

/** Mock src/lib/api with `vi.mock(path, mockApiModule)` so the screens talk to this fake. */
export async function mockApiModule() {
  const actual = await vi.importActual<typeof import("../../../src/lib/api")>("../../../src/lib/api");
  return { ...actual, api: fakeApi };
}

export const signedInUser = { id: "a0000000-0000-4000-8000-000000000001", email: "requester@example.test" };
/** The signed-in person, as the submitter of an agreement. */
export const me = { id: signedInUser.id, email: signedInUser.email, displayName: "Riley Requester" };
/** Someone else, so the signed-in person may review what they submitted. */
export const colleague = { id: "a0000000-0000-4000-8000-000000000099", email: "colleague@example.test", displayName: "Casey Colleague" };
const actor = { email: me.email, displayName: me.displayName };

let store = new Map<string, AgreementDetail>();
let accounts = new Map<string, ManagedUser>();
let counter = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const copy = <T>(value: T): T => structuredClone(value);

function summary(detail: AgreementDetail): AgreementSummary {
  const { id, name, vendor, agreementType, businessUnit, neededBy, submittedBy, submittedAt, status, completedAt, approvedAt, findings } = detail;
  return {
    id, name, vendor, agreementType, businessUnit, neededBy, submittedBy, submittedAt, status, completedAt, approvedAt,
    findingCount: findings.length,
    pendingFindingCount: findings.filter((f) => f.decision === "pending").length,
  };
}

function find(id: string): AgreementDetail {
  const detail = store.get(id);
  if (!detail) throw new ApiRequestError(404, "That agreement was not found.");
  return detail;
}

function assertOpen(detail: AgreementDetail) {
  if (detail.status === "approved" || detail.status === "escalated") {
    throw new ApiRequestError(409, "This review is already complete.");
  }
  if (detail.submittedBy.id === me.id) {
    throw new ApiRequestError(403, "You cannot review your own agreement. Ask another reviewer to decide it.");
  }
}

function findingWith(findingId: string): { detail: AgreementDetail; finding: FindingRecord } {
  const detail = [...store.values()].find((d) => d.findings.some((f) => f.id === findingId));
  if (!detail) throw new ApiRequestError(404, "That finding was not found.");
  return { detail, finding: detail.findings.find((f) => f.id === findingId)! };
}

const snapshot = (f: FindingRecord): FindingSnapshot => ({
  category: f.category,
  findingType: f.findingType,
  classification: f.classification,
  severity: f.severity,
  reason: f.reason,
  note: f.note,
  sourceText: f.sourceText,
  playbookExpectation: f.playbookExpectation,
  decision: f.decision,
});

function record(finding: FindingRecord, action: FindingHistoryEntry["action"], before: FindingSnapshot | null) {
  finding.history.push({ action, actor, at: new Date().toISOString(), before, after: snapshot(finding) });
}

function checkFlag(input: ManualFindingInput, agreementText: string): ManualFindingInput {
  const errors = Object.values(validateManualFinding(input, agreementText));
  if (errors.length) throw new ApiRequestError(400, errors[0]!);
  return normalizeManualFinding(input);
}

/** A rule finding as the server returns it. */
export function makeRuleFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: nextId(),
    category: "Governing Law",
    confidence: 0.98,
    sourceText: "Governed by the laws of Georgia.",
    decision: "pending",
    note: "",
    method: "local_rule",
    confidenceIndicator: null,
    decidedAt: null,
    findingType: null,
    classification: null,
    severity: null,
    reason: "",
    playbookExpectation: "",
    createdBy: null,
    history: [],
    ...overrides,
  };
}

/** Builds a stored agreement; tests use it to seed what the server already holds. */
export function makeAgreement(overrides: Partial<AgreementDetail> = {}): AgreementDetail {
  const rawText = overrides.rawText ?? "GOVERNING LAW. Governed by the laws of Georgia.";
  return {
    id: nextId(),
    name: "Pre-existing MSA.pdf",
    vendor: "Acme Supply",
    agreementType: "Master services agreement",
    businessUnit: "Shared services",
    neededBy: "2026-11-01",
    submittedBy: colleague,
    submittedAt: "2026-10-01T12:00:00.000Z",
    status: "needs_review",
    completedAt: null,
    approvedAt: null,
    findingCount: 0,
    pendingFindingCount: 0,
    rawText,
    pageCount: null,
    extractionStrategy: null,
    extractionWarnings: [],
    approvedBy: null,
    classificationStatus: null,
    classificationRejections: [],
    documents: [],
    // Keep this focused unit fixture to clauses the text actually matches.
    // Full 12-category output is covered by analyzer, API integration and browser tests.
    findings: analyzeAgreement(rawText)
      .filter((finding) => finding.classification === "present" || finding.classification === "deviation")
      .map((finding) =>
        makeRuleFinding({
          category: finding.category,
          confidence: finding.confidence,
          sourceText: finding.sourceText,
          findingType: finding.findingType?.toLowerCase() as FindingRecord["findingType"],
          classification: finding.classification ?? null,
          severity: finding.severity?.toLowerCase() as FindingRecord["severity"],
          reason: finding.reason ?? "",
          playbookExpectation: finding.playbookExpectation ?? "",
        }),
      ),
    ...overrides,
  };
}

export function seed(...agreements: AgreementDetail[]) {
  for (const agreement of agreements) store.set(agreement.id, copy(agreement));
}

/** Builds an account; tests seed them with `seedUsers`. */
export function makeUser(overrides: Partial<ManagedUser> = {}): ManagedUser {
  return {
    id: nextId(),
    email: "someone@example.test",
    displayName: "Someone",
    isActive: true,
    hasSignedIn: true,
    lastSeenAt: "2026-10-27T15:00:00.000Z",
    roles: ["requester"],
    permissions: [],
    ...overrides,
  };
}

export function seedUsers(...users: ManagedUser[]) {
  for (const user of users) accounts.set(user.id, copy(user));
}

/** The accounts the fake server holds, by email. */
export const storedUsers = () => [...accounts.values()].sort((a, b) => a.email.localeCompare(b.email)).map(copy);

/** What the fake server currently holds, newest first. */
export const stored = () => [...store.values()].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).map(copy);

export const fakeApi = {
  getSession: vi.fn(),
  listAgreements: vi.fn(async (): Promise<AgreementSummary[]> => stored().map(summary)),
  getAgreement: vi.fn(async (id: string): Promise<AgreementDetail> => copy(find(id))),
  submitAgreement: vi.fn(async (input: NewAgreementInput): Promise<AgreementDetail> => {
    const detail = makeAgreement({
      name: input.name,
      vendor: input.vendor,
      agreementType: input.agreementType,
      businessUnit: input.businessUnit,
      neededBy: input.neededBy || null,
      rawText: input.rawText,
      pageCount: input.pageCount ?? null,
      extractionStrategy: input.extractionStrategy ?? null,
      extractionWarnings: input.extractionWarnings ?? [],
      submittedBy: me,
      submittedAt: new Date().toISOString(),
    });
    store.set(detail.id, detail);
    return copy(detail);
  }),
  retryClassification: vi.fn(async (id: string): Promise<AgreementDetail> => copy(find(id))),
  completeReview: vi.fn(async (id: string): Promise<AgreementDetail> => {
    const detail = find(id);
    assertOpen(detail);
    if (detail.findings.some((f) => f.decision === "pending")) {
      throw new ApiRequestError(409, "Record a decision on every finding before completing the review.");
    }
    detail.status = detail.findings.some((f) => f.decision === "escalated") ? "escalated" : "approved";
    detail.completedAt = new Date().toISOString();
    return copy(detail);
  }),
  decideFinding: vi.fn(async (findingId: string, input: FindingDecisionInput): Promise<AgreementDetail> => {
    const { detail, finding } = findingWith(findingId);
    assertOpen(detail);
    const note = input.note ?? finding.note;
    if (input.decision !== "pending" && !note.trim()) {
      throw new ApiRequestError(400, "Add a reason before accepting, dismissing, or escalating this flag.");
    }
    if (finding.decision === input.decision && finding.note === note) return copy(detail);
    const before = snapshot(finding);
    finding.decision = input.decision;
    finding.note = note;
    record(finding, before.decision !== input.decision ? "decision" : "edited", before);
    if (detail.status === "needs_review") detail.status = "in_review";
    return copy(detail);
  }),
  addManualFinding: vi.fn(async (agreementId: string, input: ManualFindingInput): Promise<AgreementDetail> => {
    const detail = find(agreementId);
    assertOpen(detail);
    const flag = checkFlag(input, detail.rawText);
    const finding = makeRuleFinding({
      ...flag,
      confidence: 1,
      note: flag.reason,
      method: "manual",
      createdBy: actor,
    });
    record(finding, "created", null);
    detail.findings.push(finding);
    if (detail.status === "needs_review") detail.status = "in_review";
    return copy(detail);
  }),
  editManualFinding: vi.fn(async (findingId: string, input: ManualFindingInput): Promise<AgreementDetail> => {
    const { detail, finding } = findingWith(findingId);
    if (finding.method !== "manual") throw new ApiRequestError(400, "Only manual flags can be edited.");
    assertOpen(detail);
    const flag = checkFlag(input, detail.rawText);
    const before = snapshot(finding);
    Object.assign(finding, flag, { note: flag.reason });
    record(finding, "edited", before);
    return copy(detail);
  }),
  uploadDocument: vi.fn(async (agreementId: string, file: File): Promise<DocumentRecord> => {
    const record: DocumentRecord = {
      id: nextId(),
      fileName: file.name,
      contentType: file.type === "application/pdf" ? "application/pdf" : "text/plain",
      byteSize: file.size,
      uploadedAt: new Date().toISOString(),
    };
    find(agreementId).documents.push(record);
    return copy(record);
  }),
  documentUrl: (documentId: string) => `/api/documents/${documentId}`,
  categoryReport: vi.fn(async (): Promise<CategoryReport> => {
    const findings = [...store.values()].flatMap((d) => d.findings);
    return {
      agreementCount: store.size,
      categories: playbook.map(({ name }) => {
        const rows = findings.filter((f) => f.category === name);
        return {
          category: name,
          total: rows.length,
          accepted: rows.filter((f) => f.decision === "accepted").length,
          escalated: rows.filter((f) => f.decision === "escalated").length,
        };
      }),
    };
  }),
  listUsers: vi.fn(async (): Promise<ManagedUser[]> => storedUsers()),
  updateUserAccess: vi.fn(async (userId: string, input: UserAccessInput): Promise<ManagedUser> => {
    const user = accounts.get(userId);
    if (!user) throw new ApiRequestError(404, "That account was not found.");
    if (input.roles.length === 0) throw new ApiRequestError(400, "Give the account at least one role, or deactivate it instead.");
    if (input.approve && !input.roles.includes("reviewer") && !input.roles.includes("administrator")) {
      throw new ApiRequestError(400, "The Approver permission requires the Reviewer or Administrator role.");
    }
    user.roles = [...input.roles];
    user.permissions = input.approve ? ["approve"] : [];
    user.isActive = input.isActive;
    return copy(user);
  }),
};

/** Empties the store and restores every method's default behaviour. */
export function resetFakeApi() {
  store = new Map();
  accounts = new Map();
  counter = 0;
  for (const method of Object.values(fakeApi)) {
    // mockReset drops queued one-off behaviour and restores the implementation above.
    if (vi.isMockFunction(method)) method.mockReset();
  }
}
