import { segmentAgreement } from "../../../src/lib/segmentAgreement";
import type { IngestionInput, IngestionRecord } from "../../../src/shared/ingestion";
/**
 * A stand-in for the `/api` Netlify Function, for browser tests.
 *
 * The Vite dev server has no Netlify Functions, so each test page gets its own
 * in-memory copy of the API through `page.route`. It follows the workflow
 * rules the screens rely on (findings from the playbook rules on submit, a
 * decision needs a reason and moves an agreement into review, nobody reviews
 * their own agreement, manual flags are validated and keep a history,
 * completion approves or escalates) but not role-based access control:
 * tests/integration covers the real handler and database, policies included.
 */

import type { Page, Route } from "@playwright/test";

import { analyzeAgreement, playbook } from "../../../src/lib/analyze";
import { normalizeManualFinding, validateManualFinding } from "../../../src/lib/manualFinding";
import type {
  AgreementDetail,
  AgreementSummary,
  CategoryReport,
  FindingDecisionInput,
  FindingHistoryEntry,
  FindingRecord,
  FindingSnapshot,
  ManagedUser,
  ManualFindingInput,
  NewAgreementInput,
  SessionUser,
  UserAccessInput,
} from "../../../src/shared/api";

export interface FakeServer {
  /** What the server currently holds, newest first. */
  agreements(): AgreementDetail[];
  /** The accounts the server holds, by email. */
  users(): ManagedUser[];
  /** Adds accounts, as if those people had signed in. */
  addUsers(...users: ManagedUser[]): void;
  /** Adds an agreement as if someone else had submitted it; returns it as stored. */
  addAgreement(fields: { name: string; vendor?: string; rawText: string; submittedBy?: AgreementDetail["submittedBy"] }): AgreementDetail;
  /** Makes the next request to `path` (e.g. "POST /api/agreements") fail with this status and message. */
  failNext(request: string, status: number, error: string): void;
}

export async function installFakeServer(page: Page, session: SessionUser): Promise<FakeServer> {
  const ingestions = new Map<string, IngestionRecord>();
  const store = new Map<string, AgreementDetail>();
  const failures = new Map<string, { status: number; error: string }>();
  const accounts = new Map<string, ManagedUser>([
    [
      session.id,
      {
        id: session.id,
        email: session.email,
        displayName: session.displayName,
        isActive: true,
        hasSignedIn: true,
        lastSeenAt: new Date().toISOString(),
        roles: session.roles,
        permissions: session.permissions,
      },
    ],
  ]);
  const byEmail = () => [...accounts.values()].sort((a, b) => a.email.localeCompare(b.email));

  const summary = (detail: AgreementDetail): AgreementSummary => ({
    id: detail.id,
    name: detail.name,
    vendor: detail.vendor,
    agreementType: detail.agreementType,
    businessUnit: detail.businessUnit,
    neededBy: detail.neededBy,
    submittedBy: detail.submittedBy,
    submittedAt: detail.submittedAt,
    status: detail.status,
    completedAt: detail.completedAt,
    approvedAt: detail.approvedAt,
    ingestion: detail.ingestion,
    findingCount: detail.findings.length,
    pendingFindingCount: detail.findings.filter((f) => f.decision === "pending").length,
  });
  const newest = () => [...store.values()].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const isComplete = (detail: AgreementDetail) => detail.status === "approved" || detail.status === "escalated";
  const actor = { email: session.email, displayName: session.displayName };

  const ruleFinding = (fields: Partial<FindingRecord>): FindingRecord => ({
    id: crypto.randomUUID(),
    category: "Governing Law",
    confidence: 1,
    sourceText: "",
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
    ...fields,
  });
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
  const record = (f: FindingRecord, action: FindingHistoryEntry["action"], before: FindingSnapshot | null) =>
    f.history.push({ action, actor, at: new Date().toISOString(), before, after: snapshot(f) });

  type AgreementFields = Pick<AgreementDetail, "name" | "vendor" | "agreementType" | "businessUnit" | "neededBy" | "rawText" | "submittedBy"> &
    Partial<AgreementDetail>;
  const newAgreement = (fields: AgreementFields): AgreementDetail => ({
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
    status: "needs_review",
    completedAt: null,
    approvedAt: null,
    findingCount: 0,
    pendingFindingCount: 0,
    pageCount: null,
    extractionStrategy: null,
    extractionWarnings: [],
    approvedBy: null,
    classificationStatus: "manual_required",
    classificationRejections: [],
    documents: [],
    findings: analyzeAgreement(fields.rawText).map((finding) =>
      ruleFinding({
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
    ...fields,
  });

  /** Why the session may not act on this agreement's review, if it may not. */
  const refusal = (detail: AgreementDetail): [number, string] | undefined => {
    if (isComplete(detail)) return [409, "This review is already complete."];
    if (detail.submittedBy.id === session.id) return [403, "You cannot review your own agreement. Ask another reviewer to decide it."];
    return undefined;
  };
  const checkFlag = (input: ManualFindingInput, text: string): ManualFindingInput | string => {
    const errors = Object.values(validateManualFinding(input, text));
    return errors.length ? errors[0]! : normalizeManualFinding(input);
  };

  const reply = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });
  const fail = (route: Route, status: number, error: string) => route.fulfill({ status, json: { error } });

  async function handle(route: Route) {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    const failure = failures.get(`${method} ${path}`);
    if (failure) {
      failures.delete(`${method} ${path}`);
      return fail(route, failure.status, failure.error);
    }

    let match: RegExpMatchArray | null;
    if ((match = path.match(/^\/api\/agreements\/([^/]+)\/ingestion$/))) {
      const id = match[1]!;
      const detail = store.get(id);
      const record = ingestions.get(id);
      if (!record || !detail) return fail(route, 404, "That ingestion was not found.");
      if (method === "GET") return reply(route, record);
      const input = request.postDataJSON() as IngestionInput;
      const segments = input.failed ? [] : segmentAgreement(id, input.version, input.text ?? "", input.pages);
      Object.assign(record, { state: input.failed ? "failed" : "ready", error: input.failed ? "Text could not be prepared. Retry or supply text." : null,
        text: input.text ?? "", source: input.source ?? "extracted", pages: input.pages ?? [], segments, segmentCount: segments.length });
      detail.rawText = record.text;
      detail.ingestion = { version: record.version, state: record.state, error: record.error, segmentCount: record.segmentCount };
      return reply(route, record);
    }
    if (method === "GET" && path === "/api/users") {
      if (!session.roles.includes("administrator")) return fail(route, 403, "Only administrators can manage accounts.");
      return reply(route, byEmail());
    }
    if ((match = path.match(/^\/api\/users\/([^/]+)\/access$/)) && method === "PUT") {
      if (!session.roles.includes("administrator")) return fail(route, 403, "Only administrators can manage accounts.");
      const user = accounts.get(match[1]!);
      if (!user) return fail(route, 404, "That account was not found.");
      const input = request.postDataJSON() as UserAccessInput;
      if (input.roles.length === 0) return fail(route, 400, "Give the account at least one role, or deactivate it instead.");
      if (input.approve && !input.roles.includes("reviewer") && !input.roles.includes("administrator")) {
        return fail(route, 400, "The Approver permission requires the Reviewer or Administrator role.");
      }
      Object.assign(user, { roles: input.roles, permissions: input.approve ? ["approve"] : [], isActive: input.isActive });
      return reply(route, user);
    }
    if (method === "GET" && path === "/api/session") return reply(route, session);
    if (method === "GET" && path === "/api/agreements") return reply(route, newest().map(summary));
    if (method === "GET" && path === "/api/reports/categories") {
      const findings = [...store.values()].flatMap((d) => d.findings);
      const report: CategoryReport = {
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
      return reply(route, report);
    }
    if (method === "POST" && path === "/api/agreements") {
      const input = request.postDataJSON() as NewAgreementInput;
      const id = crypto.randomUUID();
      const detail = newAgreement({
        id,
        name: input.name,
        vendor: input.vendor,
        agreementType: input.agreementType,
        businessUnit: input.businessUnit,
        neededBy: input.neededBy || null,
        submittedBy: { id: session.id, email: session.email, displayName: session.displayName },
        rawText: input.rawText,
        pageCount: input.pageCount ?? null,
        extractionStrategy: input.extractionStrategy ?? null,
        extractionWarnings: input.extractionWarnings ?? [],
      });
      if (input.deferIngestion) {
        detail.ingestion = { version: 1, state: "pending", error: null, segmentCount: 0 };
        ingestions.set(id, { ...detail.ingestion, agreementId: id, source: "extracted", text: "", pages: [], segments: [], pageCount: null, strategy: null, warnings: [] });
      }
      store.set(id, detail);
      return reply(route, detail, 201);
    }
    if ((match = path.match(/^\/api\/agreements\/([^/]+)$/)) && method === "GET") {
      const detail = store.get(match[1]!);
      return detail ? reply(route, detail) : fail(route, 404, "That agreement was not found.");
    }
    if ((match = path.match(/^\/api\/agreements\/([^/]+)\/documents$/)) && method === "POST") {
      const detail = store.get(match[1]!);
      if (!detail) return fail(route, 404, "That agreement was not found.");
      const body = request.postDataBuffer() ?? Buffer.alloc(0);
      const fileName = /filename="([^"]+)"/.exec(body.toString("latin1"))?.[1] ?? "agreement";
      const record = {
        id: crypto.randomUUID(),
        fileName,
        contentType: fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/plain",
        byteSize: body.length,
        uploadedAt: new Date().toISOString(),
      } as const;
      detail.documents.push(record);
      return reply(route, record, 201);
    }
    if ((match = path.match(/^\/api\/findings\/([^/]+)$/)) && (method === "PATCH" || method === "PUT")) {
      const detail = [...store.values()].find((d) => d.findings.some((f) => f.id === match![1]));
      if (!detail) return fail(route, 404, "That finding was not found.");
      const finding = detail.findings.find((f) => f.id === match![1])!;
      if (method === "PUT" && finding.method !== "manual") return fail(route, 400, "Only manual flags can be edited.");
      const refused = refusal(detail);
      if (refused) return fail(route, ...refused);
      const before = snapshot(finding);
      if (method === "PUT") {
        const flag = checkFlag(request.postDataJSON() as ManualFindingInput, detail.rawText);
        if (typeof flag === "string") return fail(route, 400, flag);
        Object.assign(finding, flag, { note: flag.reason });
        record(finding, "edited", before);
      } else {
        const input = request.postDataJSON() as FindingDecisionInput;
        const note = input.note ?? finding.note;
        if (input.decision !== "pending" && !note.trim()) {
          return fail(route, 400, "Add a reason before accepting, dismissing, or escalating this flag.");
        }
        if (finding.decision === input.decision && finding.note === note) return reply(route, detail);
        finding.decision = input.decision;
        finding.note = note;
        record(finding, before.decision !== input.decision ? "decision" : "edited", before);
      }
      if (detail.status === "needs_review") detail.status = "in_review";
      return reply(route, detail);
    }
    if ((match = path.match(/^\/api\/agreements\/([^/]+)\/findings$/)) && method === "POST") {
      const detail = store.get(match[1]!);
      if (!detail) return fail(route, 404, "That agreement was not found.");
      const refused = refusal(detail);
      if (refused) return fail(route, ...refused);
      const flag = checkFlag(request.postDataJSON() as ManualFindingInput, detail.rawText);
      if (typeof flag === "string") return fail(route, 400, flag);
      const finding = ruleFinding({ ...flag, note: flag.reason, method: "manual", createdBy: actor });
      record(finding, "created", null);
      detail.findings.push(finding);
      if (detail.status === "needs_review") detail.status = "in_review";
      return reply(route, detail, 201);
    }
    if ((match = path.match(/^\/api\/agreements\/([^/]+)\/complete$/)) && method === "POST") {
      const detail = store.get(match[1]!);
      if (!detail) return fail(route, 404, "That agreement was not found.");
      const refused = refusal(detail);
      if (refused) return fail(route, ...refused);
      if (detail.findings.some((f) => f.decision === "pending")) {
        return fail(route, 409, "Record a decision on every finding before completing the review.");
      }
      const escalated = detail.findings.some((f) => f.decision === "escalated");
      if (!escalated && !session.permissions.includes("approve")) {
        return fail(route, 403, "Approving an agreement requires the Approver permission.");
      }
      detail.status = escalated ? "escalated" : "approved";
      detail.completedAt = new Date().toISOString();
      return reply(route, detail);
    }
    return fail(route, 404, "That API route was not found.");
  }

  await page.route("**/api/**", handle);

  return {
    agreements: () => structuredClone(newest()),
    users: () => structuredClone(byEmail()),
    addUsers: (...users) => users.forEach((user) => accounts.set(user.id, structuredClone(user))),
    failNext: (request, status, error) => failures.set(request, { status, error }),
    addAgreement: ({
      name,
      vendor = "Northstar",
      rawText,
      submittedBy = { id: "a0000000-0000-4000-8000-000000000099", email: "colleague@example.test", displayName: "Casey Colleague" },
    }) => {
      const detail = newAgreement({ name, vendor, agreementType: "MSA", businessUnit: "Legal", neededBy: "2026-12-01", rawText, submittedBy });
      store.set(detail.id, detail);
      return structuredClone(detail);
    },
  };
}
