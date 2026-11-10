/**
 * In-memory `/api` for `vite` on this machine.
 *
 * Netlify Identity and the database are not available under `npm run dev`.
 * This middleware lets the review screens load anyway. It is attached only
 * from the Vite dev server, so a production build and a Netlify deploy never
 * serve it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { demoAgreementText } from "../src/data.ts";
import { localTestUser } from "../src/devSession.ts";
import { analyzeAgreement, playbook } from "../src/lib/analyze.ts";
import { normalizeManualFinding, validateManualFinding } from "../src/lib/manualFinding.ts";
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
} from "../src/shared/api.ts";

type ApiResult =
  | { status: number; json: unknown }
  | { status: number; raw: string; contentType: string };

const colleague = {
  id: "00000000-0000-4000-8000-0000000000b2",
  email: "colleague@example.test",
  displayName: "Casey Colleague",
};

export function createLocalApi() {
  const store = new Map<string, AgreementDetail>();
  const files = new Map<string, string>();
  const accounts = new Map<string, ManagedUser>([
    [
      localTestUser.id,
      {
        ...localTestUser,
        isActive: true,
        hasSignedIn: true,
        lastSeenAt: new Date().toISOString(),
      },
    ],
  ]);

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
    findingCount: detail.findings.length,
    pendingFindingCount: detail.findings.filter((finding) => finding.decision === "pending").length,
  });

  const newest = () => [...store.values()].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

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

  const snapshot = (finding: FindingRecord): FindingSnapshot => ({
    category: finding.category,
    findingType: finding.findingType,
    classification: finding.classification,
    severity: finding.severity,
    reason: finding.reason,
    note: finding.note,
    sourceText: finding.sourceText,
    playbookExpectation: finding.playbookExpectation,
    decision: finding.decision,
  });

  const record = (finding: FindingRecord, action: FindingHistoryEntry["action"], before: FindingSnapshot | null) => {
    finding.history.push({
      action,
      actor: { email: localTestUser.email, displayName: localTestUser.displayName },
      at: new Date().toISOString(),
      before,
      after: snapshot(finding),
    });
  };

  const fromRules = (rawText: string): FindingRecord[] =>
    analyzeAgreement(rawText).map((finding) =>
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
    );

  const addAgreement = (fields: {
    name: string;
    vendor: string;
    agreementType: string;
    businessUnit: string;
    neededBy: string | null;
    rawText: string;
    submittedBy: AgreementDetail["submittedBy"];
    submittedAt: string;
    pageCount?: number | null;
    extractionStrategy?: string | null;
    extractionWarnings?: string[];
  }): AgreementDetail => {
    const detail: AgreementDetail = {
      id: crypto.randomUUID(),
      name: fields.name,
      vendor: fields.vendor,
      agreementType: fields.agreementType,
      businessUnit: fields.businessUnit,
      neededBy: fields.neededBy,
      submittedBy: fields.submittedBy,
      submittedAt: fields.submittedAt,
      status: "needs_review",
      completedAt: null,
      approvedAt: null,
      findingCount: 0,
      pendingFindingCount: 0,
      rawText: fields.rawText,
      pageCount: fields.pageCount ?? null,
      extractionStrategy: fields.extractionStrategy ?? null,
      extractionWarnings: fields.extractionWarnings ?? [],
      approvedBy: null,
      classificationStatus: "manual_required",
      classificationRejections: [],
      documents: [],
      findings: fromRules(fields.rawText),
    };
    store.set(detail.id, detail);
    return detail;
  };

  addAgreement({
    name: "Northstar MSA.txt",
    vendor: "Northstar Data",
    agreementType: "Master services agreement",
    businessUnit: "Shared services",
    neededBy: "2026-12-01",
    rawText: demoAgreementText,
    submittedBy: colleague,
    submittedAt: "2026-11-09T21:00:00.000Z",
  });
  addAgreement({
    name: "My draft agreement.txt",
    vendor: "Harbor Logistics",
    agreementType: "Master services agreement",
    businessUnit: "Operations",
    neededBy: "2026-12-15",
    rawText: "GOVERNING LAW. This Agreement is governed by the laws of Georgia.",
    submittedBy: { id: localTestUser.id, email: localTestUser.email, displayName: localTestUser.displayName },
    submittedAt: "2026-11-09T18:00:00.000Z",
  });

  const refusal = (detail: AgreementDetail): [number, string] | undefined => {
    if (detail.status === "approved" || detail.status === "escalated") return [409, "This review is already complete."];
    if (detail.submittedBy.id === localTestUser.id) {
      return [403, "You cannot review your own agreement. Ask another reviewer to decide it."];
    }
    return undefined;
  };

  const checkFlag = (input: ManualFindingInput, text: string): ManualFindingInput | string => {
    const errors = Object.values(validateManualFinding(input, text));
    return errors.length ? errors[0]! : normalizeManualFinding(input);
  };

  const fail = (status: number, error: string): ApiResult => ({ status, json: { error } });

  function handle(method: string, pathname: string, body?: unknown): ApiResult {
    let match: RegExpMatchArray | null;
    if (method === "GET" && pathname === "/api/session") return { status: 200, json: localTestUser };
    if (method === "GET" && pathname === "/api/agreements") return { status: 200, json: newest().map(summary) };
    if (method === "GET" && pathname === "/api/users") return { status: 200, json: [...accounts.values()] };
    if (method === "GET" && pathname === "/api/reports/categories") {
      const findings = [...store.values()].flatMap((detail) => detail.findings);
      const report: CategoryReport = {
        agreementCount: store.size,
        categories: playbook.map(({ name }) => {
          const rows = findings.filter((finding) => finding.category === name);
          return {
            category: name,
            total: rows.length,
            accepted: rows.filter((finding) => finding.decision === "accepted").length,
            escalated: rows.filter((finding) => finding.decision === "escalated").length,
          };
        }),
      };
      return { status: 200, json: report };
    }
    if (method === "POST" && pathname === "/api/agreements") {
      const input = body as NewAgreementInput;
      const detail = addAgreement({
        name: input.name,
        vendor: input.vendor,
        agreementType: input.agreementType,
        businessUnit: input.businessUnit,
        neededBy: input.neededBy || null,
        rawText: input.rawText,
        submittedBy: { id: localTestUser.id, email: localTestUser.email, displayName: localTestUser.displayName },
        submittedAt: new Date().toISOString(),
        pageCount: input.pageCount ?? null,
        extractionStrategy: input.extractionStrategy ?? null,
        extractionWarnings: input.extractionWarnings ?? [],
      });
      return { status: 201, json: detail };
    }
    if ((match = pathname.match(/^\/api\/agreements\/([^/]+)$/)) && method === "GET") {
      const detail = store.get(match[1]!);
      return detail ? { status: 200, json: detail } : fail(404, "That agreement was not found.");
    }
    if ((match = pathname.match(/^\/api\/agreements\/([^/]+)\/classify$/)) && method === "POST") {
      const detail = store.get(match[1]!);
      return detail ? { status: 200, json: detail } : fail(404, "That agreement was not found.");
    }
    if ((match = pathname.match(/^\/api\/agreements\/([^/]+)\/documents$/)) && method === "POST") {
      const detail = store.get(match[1]!);
      if (!detail) return fail(404, "That agreement was not found.");
      const raw = typeof body === "string" ? body : "";
      const fileName = /filename="([^"]+)"/.exec(raw)?.[1] ?? "agreement.txt";
      const record: DocumentRecord = {
        id: crypto.randomUUID(),
        fileName,
        contentType: fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/plain",
        byteSize: raw.length,
        uploadedAt: new Date().toISOString(),
      };
      detail.documents.push(record);
      files.set(record.id, raw);
      return { status: 201, json: record };
    }
    if ((match = pathname.match(/^\/api\/documents\/([^/]+)$/)) && method === "GET") {
      const raw = files.get(match[1]!);
      if (raw === undefined) return fail(404, "That file was not found.");
      return { status: 200, raw, contentType: "application/octet-stream" };
    }
    if ((match = pathname.match(/^\/api\/users\/([^/]+)\/access$/)) && method === "PUT") {
      const user = accounts.get(match[1]!);
      if (!user) return fail(404, "That account was not found.");
      const input = body as UserAccessInput;
      if (input.roles.length === 0) return fail(400, "Give the account at least one role, or deactivate it instead.");
      if (input.approve && !input.roles.includes("reviewer") && !input.roles.includes("administrator")) {
        return fail(400, "The Approver permission requires the Reviewer or Administrator role.");
      }
      user.roles = input.roles;
      user.permissions = input.approve ? ["approve"] : [];
      user.isActive = input.isActive;
      return { status: 200, json: user };
    }
    if ((match = pathname.match(/^\/api\/findings\/([^/]+)$/)) && (method === "PATCH" || method === "PUT")) {
      const detail = [...store.values()].find((item) => item.findings.some((finding) => finding.id === match![1]));
      if (!detail) return fail(404, "That finding was not found.");
      const finding = detail.findings.find((item) => item.id === match![1])!;
      if (method === "PUT" && finding.method !== "manual") return fail(400, "Only manual flags can be edited.");
      const refused = refusal(detail);
      if (refused) return fail(refused[0], refused[1]);
      const before = snapshot(finding);
      if (method === "PUT") {
        const flag = checkFlag(body as ManualFindingInput, detail.rawText);
        if (typeof flag === "string") return fail(400, flag);
        Object.assign(finding, flag, { note: flag.reason });
        record(finding, "edited", before);
      } else {
        const input = body as FindingDecisionInput;
        const note = input.note ?? finding.note;
        if (input.decision !== "pending" && !note.trim()) {
          return fail(400, "Add a reason before accepting, dismissing, or escalating this flag.");
        }
        finding.decision = input.decision;
        finding.note = note;
        record(finding, before.decision !== input.decision ? "decision" : "edited", before);
      }
      if (detail.status === "needs_review") detail.status = "in_review";
      return { status: 200, json: detail };
    }
    if ((match = pathname.match(/^\/api\/agreements\/([^/]+)\/findings$/)) && method === "POST") {
      const detail = store.get(match[1]!);
      if (!detail) return fail(404, "That agreement was not found.");
      const refused = refusal(detail);
      if (refused) return fail(refused[0], refused[1]);
      const flag = checkFlag(body as ManualFindingInput, detail.rawText);
      if (typeof flag === "string") return fail(400, flag);
      const finding = ruleFinding({
        ...flag,
        note: flag.reason,
        method: "manual",
        confidence: 1,
        createdBy: { email: localTestUser.email, displayName: localTestUser.displayName },
      });
      record(finding, "created", null);
      detail.findings.push(finding);
      if (detail.status === "needs_review") detail.status = "in_review";
      return { status: 201, json: detail };
    }
    if ((match = pathname.match(/^\/api\/agreements\/([^/]+)\/complete$/)) && method === "POST") {
      const detail = store.get(match[1]!);
      if (!detail) return fail(404, "That agreement was not found.");
      const refused = refusal(detail);
      if (refused) return fail(refused[0], refused[1]);
      if (detail.findings.some((finding) => finding.decision === "pending")) {
        return fail(409, "Record a decision on every finding before completing the review.");
      }
      const escalated = detail.findings.some((finding) => finding.decision === "escalated");
      detail.status = escalated ? "escalated" : "approved";
      detail.completedAt = new Date().toISOString();
      return { status: 200, json: detail };
    }
    return fail(404, "That API route was not found.");
  }

  return { handle };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Connect middleware. Requests outside `/api` are passed through to Vite. */
export function localDevApi() {
  const api = createLocalApi();
  return (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (!pathname.startsWith("/api/")) {
      next();
      return;
    }
    const method = req.method ?? "GET";
    readBody(req)
      .then((raw) => {
        const type = req.headers["content-type"] ?? "";
        let body: unknown = raw;
        if (type.includes("application/json") && raw) body = JSON.parse(raw) as unknown;
        const result = api.handle(method, pathname, body);
        res.statusCode = result.status;
        if ("raw" in result) {
          res.setHeader("content-type", result.contentType);
          res.end(result.raw);
          return;
        }
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(result.json));
      })
      .catch((error: unknown) => {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : "The local API could not read that request." }));
      });
  };
}
