/**
 * The API end to end against a real database.
 *
 * Every test starts from the four committed migrations, seed data included,
 * applied to Netlify's local Postgres (PGlite). Requests go through the same
 * handler the Netlify Function uses, with only two stand-ins: an in-memory
 * document store instead of Netlify Blobs, and a fake identity check that
 * reads the signed-in user from a test header instead of verifying a Netlify
 * Identity token.
 *
 * Because the handler queries as `clausepilot_app`, these tests exercise the
 * row-level security policies, not just the service code above them.
 */

import { NetlifyDB } from "@netlify/database-dev";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AgreementDetail, AgreementSummary, CategoryReport, ManagedUser, SessionUser } from "../../src/shared/api.ts";
import { playbook } from "../../src/lib/analyze.ts";
import { createApiHandler } from "../../server/api.ts";
import { createDatabase, type ConnectionPool } from "../../server/db.ts";
import { createMemoryDocumentStore } from "../../server/documentStore.ts";
import type { IdentityUser } from "../../server/session.ts";

const ORIGIN = "https://clausepilot.example";
const MIGRATIONS = new URL("../../netlify/database/migrations", import.meta.url).pathname;


/** Netlify Identity users; the seeded app accounts are claimed by these emails. */
const people = {
  requester: { id: "idp-requester", email: "requester@example.test", name: "Riley" },
  reviewer: { id: "idp-reviewer", email: "reviewer@example.test", name: "Rowan" },
  approver: { id: "idp-approver", email: "approver@example.test", name: "Avery" },
  admin: { id: "idp-admin", email: "admin@example.test", name: "Alex" },
  stranger: { id: "idp-stranger", email: "stranger@example.test", name: "Sam" },
  founder: { id: "idp-founder", email: "Founder@Example.test", name: "Fran" },
} satisfies Record<string, IdentityUser>;
type Person = keyof typeof people;

const SEEDED = {
  newAgreement: "b0000000-0000-4000-8000-000000000001",
  inReview: "b0000000-0000-4000-8000-000000000002",
  approved: "b0000000-0000-4000-8000-000000000003",
  adminSubmitted: "b0000000-0000-4000-8000-000000000004",
  reviewerUser: "a0000000-0000-4000-8000-000000000002",
  requesterUser: "a0000000-0000-4000-8000-000000000001",
};

let netlifyDb: NetlifyDB;
let pool: pg.Pool;
let documents: ReturnType<typeof createMemoryDocumentStore>;
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  netlifyDb = new NetlifyDB({ logger: () => undefined });
  const connectionString = await netlifyDb.start();
  // PGlite serves one connection at a time.
  pool = new pg.Pool({ connectionString, max: 1 });
}, 60_000);

afterAll(async () => {
  await pool?.end();
  await netlifyDb?.stop();
});

beforeEach(async () => {
  await netlifyDb.reset();
  await netlifyDb.applyMigrations(MIGRATIONS);
  documents = createMemoryDocumentStore();
  handle = createApiHandler({
    database: createDatabase(pool as unknown as ConnectionPool),
    documents,
    authenticate: async (request) => {
      const who = request.headers.get("x-test-person") as Person | null;
      return who ? people[who] : null;
    },
    bootstrapAdmins: new Set(["founder@example.test"]),
  });
}, 60_000);

interface Call {
  as?: Person;
  method?: string;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

async function call(path: string, { as, method = "GET", body, form, headers = {} }: Call = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (as) (init.headers as Record<string, string>)["x-test-person"] = as;
  if (body !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (form) init.body = form;
  const response = await handle(new Request(`${ORIGIN}${path}`, init));
  return response;
}

async function callJson<T>(path: string, options: Call = {}): Promise<{ status: number; body: T }> {
  const response = await call(path, options);
  return { status: response.status, body: (await response.json()) as T };
}

const newAgreement = {
  name: "Acme Cloud Hosting",
  vendor: "Acme Hosting",
  agreementType: "Services Agreement",
  businessUnit: "IT",
  neededBy: "2026-12-01",
  rawText:
    "This Agreement is governed by the laws of the State of Georgia. Customer may terminate this Agreement for any reason upon thirty days' written notice.",
  // Not part of the contract: the server must ignore anything like this.
  findings: [{ category: "Exclusivity", confidence: 1, decision: "accepted" }],
};

const pdfFile = (name = "contract.pdf") =>
  new File([new TextEncoder().encode("%PDF-1.7\n%fake but well-formed header\n")], name, { type: "application/pdf" });

describe("sign-in and sessions", () => {
  it("rejects requests without a signed-in user", async () => {
    const { status, body } = await callJson<{ error: string }>("/api/session");
    expect(status).toBe(401);
    expect(body.error).toMatch(/sign in/i);
  });

  it("links a seeded account to its Identity user on first sign-in, by email", async () => {
    const { status, body } = await callJson<SessionUser>("/api/session", { as: "reviewer" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: SEEDED.reviewerUser, email: "reviewer@example.test", roles: ["reviewer"], permissions: [] });

    const again = await callJson<SessionUser>("/api/session", { as: "reviewer" });
    expect(again.body.id).toBe(SEEDED.reviewerUser);
  });

  it("represents Approver as a permission on top of the Reviewer role", async () => {
    const { body } = await callJson<SessionUser>("/api/session", { as: "approver" });
    expect(body.roles).toEqual(["reviewer"]);
    expect(body.permissions).toEqual(["approve"]);
  });

  it("gives a newly invited person the Requester role", async () => {
    const { body } = await callJson<SessionUser>("/api/session", { as: "stranger" });
    expect(body).toMatchObject({ email: "stranger@example.test", roles: ["requester"], permissions: [] });
  });

  it("makes configured bootstrap emails administrators, matching case-insensitively", async () => {
    const { body } = await callJson<SessionUser>("/api/session", { as: "founder" });
    expect(body.email).toBe("founder@example.test");
    expect(body.roles).toEqual(["requester", "administrator"]);
  });

  it("refuses cross-site writes that would ride the session cookie", async () => {
    const response = await call("/api/agreements", {
      as: "requester",
      method: "POST",
      body: newAgreement,
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });
});

describe("agreement visibility", () => {
  it("shows requesters only their own agreements", async () => {
    const { body } = await callJson<AgreementSummary[]>("/api/agreements", { as: "requester" });
    expect(body.map((a) => a.id).sort()).toEqual([SEEDED.newAgreement, SEEDED.inReview, SEEDED.approved].sort());
  });

  it("shows reviewers every agreement", async () => {
    const { body } = await callJson<AgreementSummary[]>("/api/agreements", { as: "reviewer" });
    expect(body).toHaveLength(4);
  });

  it("hides another person's agreement as not found rather than forbidden", async () => {
    const { status } = await callJson(`/api/agreements/${SEEDED.adminSubmitted}`, { as: "requester" });
    expect(status).toBe(404);
  });

  it("shows nothing to a new requester", async () => {
    const { body } = await callJson<AgreementSummary[]>("/api/agreements", { as: "stranger" });
    expect(body).toEqual([]);
  });
});

describe("submitting and reviewing", () => {
  it("records the submitter and generates findings on the server", async () => {
    const { status, body } = await callJson<AgreementDetail>("/api/agreements", {
      as: "requester",
      method: "POST",
      body: newAgreement,
    });
    expect(status).toBe(201);
    expect(body.status).toBe("needs_review");
    expect(body.submittedBy.email).toBe("requester@example.test");
    expect(body.neededBy).toBe("2026-12-01");
    expect(body.findings).toHaveLength(12);
    expect(body.findings.find((f) => f.category === "Governing Law")).toMatchObject({
      findingType: "provision",
      classification: "present",
      severity: "medium",
    });
    expect(body.findings.find((f) => f.category === "Audit Rights")).toMatchObject({
      findingType: "gap",
      classification: "gap",
      severity: "medium",
      sourceText: "",
      playbookExpectation: "The agreement addresses audit or inspection rights.",
    });
    expect(body.findings.every((f) => f.decision === "pending" && f.method === "local_rule")).toBe(true);
  });

  it("validates the submission", async () => {
    const { status, body } = await callJson<{ error: string }>("/api/agreements", {
      as: "requester",
      method: "POST",
      body: { ...newAgreement, vendor: " " },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/vendor/i);
  });

  it("does not let reviewers submit agreements", async () => {
    const { status } = await callJson("/api/agreements", { as: "reviewer", method: "POST", body: newAgreement });
    expect(status).toBe(403);
  });

  it("does not let a requester decide findings, even on their own agreement", async () => {
    const detail = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "requester" });
    const finding = detail.body.findings[0]!;
    const { status } = await callJson(`/api/findings/${finding.id}`, {
      as: "requester",
      method: "PATCH",
      body: { decision: "accepted" },
    });
    expect(status).toBe(403);
  });

  it("moves an agreement into review when a reviewer records a decision", async () => {
    const detail = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "reviewer" });
    const finding = detail.body.findings[0]!;
    const { status, body } = await callJson<AgreementDetail>(`/api/findings/${finding.id}`, {
      as: "reviewer",
      method: "PATCH",
      body: { decision: "accepted", note: "Fine." },
    });
    expect(status).toBe(200);
    expect(body.status).toBe("in_review");
    expect(body.findings.find((f) => f.id === finding.id)).toMatchObject({ decision: "accepted", note: "Fine." });
  });

  async function acceptAll(agreementId: string, as: Person) {
    const detail = await callJson<AgreementDetail>(`/api/agreements/${agreementId}`, { as });
    for (const finding of detail.body.findings) {
      await call(`/api/findings/${finding.id}`, { as, method: "PATCH", body: { decision: "accepted", note: "Matches the playbook." } });
    }
  }

  it("won't complete a review while findings are pending", async () => {
    const { status } = await callJson(`/api/agreements/${SEEDED.inReview}/complete`, { as: "approver", method: "POST" });
    expect(status).toBe(409);
  });

  it("requires the Approver permission to approve", async () => {
    await acceptAll(SEEDED.inReview, "reviewer");
    const denied = await callJson<{ error: string }>(`/api/agreements/${SEEDED.inReview}/complete`, {
      as: "reviewer",
      method: "POST",
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/Approver permission/);

    const approved = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.inReview}/complete`, {
      as: "approver",
      method: "POST",
    });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.approvedBy).toBe("a0000000-0000-4000-8000-000000000003");
  });

  it("lets any reviewer complete a review as escalated", async () => {
    const detail = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "reviewer" });
    const [first, ...rest] = detail.body.findings;
    await call(`/api/findings/${first!.id}`, { as: "reviewer", method: "PATCH", body: { decision: "escalated", note: "Needs Legal." } });
    for (const finding of rest) {
      await call(`/api/findings/${finding.id}`, { as: "reviewer", method: "PATCH", body: { decision: "dismissed", note: "Not material." } });
    }
    const { status, body } = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}/complete`, {
      as: "reviewer",
      method: "POST",
    });
    expect(status).toBe(200);
    expect(body.status).toBe("escalated");
    expect(body.completedAt).not.toBeNull();
  });

  it("requires a reason before a decision", async () => {
    const detail = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "reviewer" });
    const finding = detail.body.findings[0]!;
    const refused = await callJson<{ error: string }>(`/api/findings/${finding.id}`, {
      as: "reviewer",
      method: "PATCH",
      body: { decision: "accepted", note: "   " },
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("Add a reason before accepting, dismissing, or escalating this flag.");

    // A note saved earlier counts as the reason.
    await call(`/api/findings/${finding.id}`, { as: "reviewer", method: "PATCH", body: { decision: "pending", note: "Standard clause." } });
    const accepted = await callJson<AgreementDetail>(`/api/findings/${finding.id}`, {
      as: "reviewer",
      method: "PATCH",
      body: { decision: "accepted" },
    });
    expect(accepted.status).toBe(200);
  });

  it("won't let anyone review an agreement they submitted", async () => {
    // The founder is a Requester and an Administrator, so they may both submit and review.
    const own = await callJson<AgreementDetail>("/api/agreements", { as: "founder", method: "POST", body: newAgreement });
    const finding = own.body.findings[0]!;

    for (const attempt of [
      call(`/api/findings/${finding.id}`, { as: "founder", method: "PATCH", body: { decision: "accepted", note: "Mine." } }),
      call(`/api/agreements/${own.body.id}/findings`, { as: "founder", method: "POST", body: gapFlag }),
      call(`/api/agreements/${own.body.id}/complete`, { as: "founder", method: "POST" }),
    ]) {
      const response = await attempt;
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toMatch(/cannot review your own agreement/);
    }

    const byReviewer = await call(`/api/findings/${finding.id}`, {
      as: "reviewer",
      method: "PATCH",
      body: { decision: "accepted", note: "Fine." },
    });
    expect(byReviewer.status).toBe(200);
  });
});

const NEW_AGREEMENT_TEXT = "This Agreement is governed by the laws of the State of Georgia.";
const provisionFlag = {
  category: "Governing Law",
  findingType: "provision",
  severity: "high",
  reason: "The clause selects an unexpected governing law.",
  sourceText: NEW_AGREEMENT_TEXT,
  playbookExpectation: "",
};
const gapFlag = {
  category: "Insurance",
  findingType: "gap",
  severity: "medium",
  reason: "No insurance requirement appears anywhere.",
  sourceText: "",
  playbookExpectation: "Vendors must carry commercial general liability insurance.",
};

describe("manual flags", () => {
  const addFlag = (body: unknown, as: Person = "reviewer") =>
    callJson<AgreementDetail & { error?: string }>(`/api/agreements/${SEEDED.newAgreement}/findings`, { as, method: "POST", body });
  const manual = (detail: AgreementDetail) => detail.findings.filter((f) => f.method === "manual");

  it("creates a provision flag with its type, severity, reason, evidence, creator and history", async () => {
    const { status, body } = await addFlag(provisionFlag);
    expect(status).toBe(201);
    expect(body.status).toBe("in_review");
    const [flag] = manual(body);
    expect(flag).toMatchObject({
      category: "Governing Law",
      findingType: "provision",
      severity: "high",
      reason: provisionFlag.reason,
      note: provisionFlag.reason,
      sourceText: NEW_AGREEMENT_TEXT,
      playbookExpectation: "",
      decision: "pending",
      confidence: 1,
      createdBy: { email: "reviewer@example.test" },
    });
    expect(flag!.history).toHaveLength(1);
    expect(flag!.history[0]).toMatchObject({ action: "created", before: null, actor: { email: "reviewer@example.test" } });
    expect(flag!.history[0]!.after).toMatchObject({ findingType: "provision", severity: "high", decision: "pending" });
  });

  it("creates a gap flag that cites no contract text", async () => {
    const { status, body } = await addFlag(gapFlag);
    expect(status).toBe(201);
    expect(manual(body)[0]).toMatchObject({ findingType: "gap", sourceText: "", playbookExpectation: gapFlag.playbookExpectation });
  });

  it.each([
    ["a category outside the playbook", { ...provisionFlag, category: "Indemnification" }, /12 approved categories/],
    ["text that isn't in the agreement", { ...provisionFlag, sourceText: "Governed by the laws of Mars." }, /must match text in the agreement exactly/],
    ["a provision with no text", { ...provisionFlag, sourceText: " " }, /Enter exact supporting text/],
    ["a gap that cites contract text", { ...gapFlag, sourceText: "invented contract text" }, /cannot include invented contract text/],
    ["a gap with no expectation", { ...gapFlag, playbookExpectation: "" }, /Reference the applicable playbook expectation/],
    ["no reason", { ...provisionFlag, reason: " " }, /Reason is required/],
    ["an unknown severity", { ...provisionFlag, severity: "urgent" }, /Severity must be one of/],
  ])("refuses %s", async (_case, body, message) => {
    const { status, body: error } = await addFlag(body);
    expect(status).toBe(400);
    expect(error.error).toMatch(message);
  });

  it("edits a flag and keeps its history: created, decision, edited", async () => {
    const created = manual((await addFlag(provisionFlag)).body)[0]!;
    await callJson(`/api/findings/${created.id}`, { as: "reviewer", method: "PATCH", body: { decision: "accepted" } });
    const edited = await callJson<AgreementDetail>(`/api/findings/${created.id}`, {
      as: "reviewer",
      method: "PUT",
      body: { ...provisionFlag, reason: "Updated after accepting the finding." },
    });
    expect(edited.status).toBe(200);
    const flag = manual(edited.body)[0]!;
    expect(flag).toMatchObject({ reason: "Updated after accepting the finding.", decision: "accepted" });
    expect(flag.history.map((entry) => entry.action)).toEqual(["created", "decision", "edited"]);
    expect(flag.history[1]).toMatchObject({ before: { decision: "pending" }, after: { decision: "accepted" } });
    expect(flag.history[2]!.before).toMatchObject({ decision: "accepted", reason: provisionFlag.reason });

    // Saving the same values again adds nothing.
    await call(`/api/findings/${created.id}`, { as: "reviewer", method: "PUT", body: { ...provisionFlag, reason: "Updated after accepting the finding." } });
    const again = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "reviewer" });
    expect(manual(again.body)[0]!.history).toHaveLength(3);
  });

  it("changes a provision into a gap, dropping the cited text", async () => {
    const created = manual((await addFlag(provisionFlag)).body)[0]!;
    const { body } = await callJson<AgreementDetail>(`/api/findings/${created.id}`, {
      as: "reviewer",
      method: "PUT",
      body: { ...gapFlag, category: "Governing Law" },
    });
    expect(manual(body)[0]).toMatchObject({ findingType: "gap", sourceText: "", playbookExpectation: gapFlag.playbookExpectation });
  });

  it("records a decision change, and a note change as an edit", async () => {
    const detail = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "reviewer" });
    const rule = detail.body.findings[0]!;
    expect(rule.history).toEqual([]);
    await call(`/api/findings/${rule.id}`, { as: "reviewer", method: "PATCH", body: { decision: "accepted", note: "Fine." } });
    await call(`/api/findings/${rule.id}`, { as: "reviewer", method: "PATCH", body: { decision: "escalated" } });
    const { body } = await callJson<AgreementDetail>(`/api/findings/${rule.id}`, {
      as: "reviewer",
      method: "PATCH",
      body: { decision: "escalated", note: "Needs Legal after all." },
    });
    const history = body.findings.find((f) => f.id === rule.id)!.history;
    expect(history.map((entry) => entry.action)).toEqual(["decision", "decision", "edited"]);
    expect(history[1]).toMatchObject({ before: { decision: "accepted" }, after: { decision: "escalated" } });
  });

  it("won't edit a rule finding", async () => {
    const detail = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "reviewer" });
    const { status, body } = await callJson<{ error: string }>(`/api/findings/${detail.body.findings[0]!.id}`, {
      as: "reviewer",
      method: "PUT",
      body: provisionFlag,
    });
    expect(status).toBe(400);
    expect(body.error).toBe("Only manual flags can be edited.");
  });

  it("won't let a requester add or edit flags", async () => {
    const created = manual((await addFlag(provisionFlag)).body)[0]!;
    expect((await addFlag(gapFlag, "requester")).status).toBe(403);
    const edit = await call(`/api/findings/${created.id}`, { as: "requester", method: "PUT", body: gapFlag });
    expect(edit.status).toBe(403);
  });

  it("withholds internal history and notes from the requester", async () => {
    await addFlag(provisionFlag);
    const { body } = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "requester" });
    const flag = manual(body)[0]!;
    expect(flag.history).toHaveLength(0);
    expect(flag.note).toBe("");
    expect(flag.createdBy).toBeNull();
  });

  it("backfills manual findings made before these fields existed", async () => {
    const { body } = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.adminSubmitted}`, { as: "reviewer" });
    expect(manual(body)[0]).toMatchObject({ findingType: "provision", severity: "medium", reason: "Added during review." });
  });
});

describe("private document storage", () => {
  async function upload(as: Person, agreementId: string, file: File) {
    const form = new FormData();
    form.set("file", file);
    return callJson<{ id: string; error?: string }>(`/api/agreements/${agreementId}/documents`, {
      as,
      method: "POST",
      form,
    });
  }

  it("stores an upload privately and serves it only to people who can see the agreement", async () => {
    const uploaded = await upload("requester", SEEDED.newAgreement, pdfFile());
    expect(uploaded.status).toBe(201);
    expect(documents.keys()).toEqual([`agreements/${SEEDED.newAgreement}/${uploaded.body.id}`]);

    const own = await call(`/api/documents/${uploaded.body.id}`, { as: "requester" });
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("application/pdf");
    expect(own.headers.get("cache-control")).toContain("no-store");
    expect(new TextDecoder().decode(await own.arrayBuffer())).toMatch(/^%PDF-1\.7/);

    expect((await call(`/api/documents/${uploaded.body.id}`, { as: "reviewer" })).status).toBe(200);
    expect((await call(`/api/documents/${uploaded.body.id}`, { as: "stranger" })).status).toBe(404);
    expect((await call(`/api/documents/${uploaded.body.id}`)).status).toBe(401);
  });

  it("does not let a requester attach files to someone else's agreement", async () => {
    const { status } = await upload("stranger", SEEDED.newAgreement, pdfFile());
    expect(status).toBe(404);
    expect(documents.keys()).toEqual([]);
  });

  it("does not let a requester attach files once review has started", async () => {
    const { status } = await upload("requester", SEEDED.inReview, pdfFile());
    expect(status).toBe(403);
    expect(documents.keys()).toEqual([]);
  });

  it("checks the file's contents, not just its name", async () => {
    const fake = new File(["just text"], "contract.pdf", { type: "application/pdf" });
    expect((await upload("requester", SEEDED.newAgreement, fake)).status).toBe(400);
    const exe = new File(["MZ"], "tool.exe", { type: "application/octet-stream" });
    expect((await upload("requester", SEEDED.newAgreement, exe)).status).toBe(400);
  });
});

describe("category report", () => {
  /** What the report should say, worked out from the agreements this person can open. */
  async function expectedReport(as: Person) {
    const list = await callJson<AgreementSummary[]>("/api/agreements", { as });
    const details = await Promise.all(list.body.map((a) => callJson<AgreementDetail>(`/api/agreements/${a.id}`, { as })));
    const findings = details.flatMap((d) => d.body.findings);
    return {
      agreementCount: list.body.length,
      categories: playbook.map(({ name }) => {
        const inCategory = findings.filter((f) => f.category === name);
        return {
          category: name,
          total: inCategory.length,
          accepted: inCategory.filter((f) => f.decision === "accepted").length,
          escalated: inCategory.filter((f) => f.decision === "escalated").length,
        };
      }),
    };
  }

  it.each(["requester", "reviewer"] as const)("counts only what the %s may see", async (as) => {
    const { status, body } = await callJson<CategoryReport>("/api/reports/categories", { as });
    expect(status).toBe(200);
    expect(body).toEqual(await expectedReport(as));
  });

  it("lists every approved category, even with no findings", async () => {
    const { body } = await callJson<CategoryReport>("/api/reports/categories", { as: "stranger" });
    expect(body.agreementCount).toBe(0);
    expect(body.categories.map((row) => row.category)).toEqual(playbook.map((c) => c.name));
    expect(body.categories.every((row) => row.total === 0)).toBe(true);
  });

  it("reflects a decision as soon as it is recorded", async () => {
    const before = await callJson<CategoryReport>("/api/reports/categories", { as: "reviewer" });
    const detail = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "reviewer" });
    const finding = detail.body.findings[0]!;
    await callJson(`/api/findings/${finding.id}`, { as: "reviewer", method: "PATCH", body: { decision: "escalated", note: "Needs Legal." } });

    const after = await callJson<CategoryReport>("/api/reports/categories", { as: "reviewer" });
    const row = (report: CategoryReport) => report.categories.find((r) => r.category === finding.category)!;
    expect(row(after.body).escalated).toBe(row(before.body).escalated + 1);
  });
});

describe("account administration", () => {
  it("is limited to administrators", async () => {
    expect((await callJson("/api/users", { as: "reviewer" })).status).toBe(403);
    const { status, body } = await callJson<ManagedUser[]>("/api/users", { as: "admin" });
    expect(status).toBe(200);
    expect(body.map((u) => u.email)).toContain("approver@example.test");
  });

  it("grants Approver only alongside a reviewing role", async () => {
    const denied = await callJson(`/api/users/${SEEDED.requesterUser}/access`, {
      as: "admin",
      method: "PUT",
      body: { roles: ["requester"], approve: true, isActive: true },
    });
    expect(denied.status).toBe(400);

    const granted = await callJson<ManagedUser>(`/api/users/${SEEDED.requesterUser}/access`, {
      as: "admin",
      method: "PUT",
      body: { roles: ["requester", "reviewer"], approve: true, isActive: true },
    });
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({ roles: ["requester", "reviewer"], permissions: ["approve"] });

    // Takes effect on the next request, without waiting for a token refresh.
    const session = await callJson<SessionUser>("/api/session", { as: "requester" });
    expect(session.body.permissions).toEqual(["approve"]);
  });

  it("stops administrators locking themselves out", async () => {
    const me = await callJson<SessionUser>("/api/session", { as: "admin" });
    const { status } = await callJson(`/api/users/${me.body.id}/access`, {
      as: "admin",
      method: "PUT",
      body: { roles: ["reviewer"], approve: false, isActive: true },
    });
    expect(status).toBe(400);
  });

  it("cuts off a deactivated account immediately", async () => {
    await callJson(`/api/users/${SEEDED.reviewerUser}/access`, {
      as: "admin",
      method: "PUT",
      body: { roles: ["reviewer"], approve: false, isActive: false },
    });
    const { status, body } = await callJson<{ error: string }>("/api/agreements", { as: "reviewer" });
    expect(status).toBe(403);
    expect(body.error).toMatch(/deactivated/);
  });
});

describe("KAN-53 persistent ingestion", () => {
  async function pendingAgreement() {
    const result = await callJson<AgreementDetail>("/api/agreements", {
      as: "requester", method: "POST", body: { ...newAgreement, rawText: "", deferIngestion: true },
    });
    expect(result.status).toBe(201);
    expect(result.body.ingestion).toMatchObject({ version: 1, state: "pending", segmentCount: 0 });
    expect(result.body.findings).toEqual([]);
    return result.body.id;
  }
  const prepare = (id: string, body: unknown, as: Person = "requester") => callJson<import("../../src/shared/ingestion.ts").IngestionRecord>(
    `/api/agreements/${id}/ingestion`, { as, method: "POST", body },
  );
  const source = { version: 1, text: "1. Governing Law\nGeorgia law applies.\n\n2. Audit Rights\nCustomer may audit records.", source: "supplied" };

  it("saves first, prepares exact ordered segments separately and persists across requests", async () => {
    const id = await pendingAgreement();
    const ready = await prepare(id, source);
    expect(ready.status).toBe(200);
    expect(ready.body.state).toBe("ready");
    expect(ready.body.segments.length).toBeGreaterThan(1);
    for (const s of ready.body.segments) expect(source.text.slice(s.startOffset, s.endOffset)).toBe(s.text);
    const fetched = await callJson<AgreementDetail>(`/api/agreements/${id}`, { as: "reviewer" });
    expect(fetched.body.rawText).toBe(source.text);
    expect(fetched.body.ingestion?.state).toBe("ready");
    const list = await callJson<AgreementSummary[]>("/api/agreements", { as: "requester" });
    expect(list.body.find((a) => a.id === id)?.ingestion?.segmentCount).toBe(ready.body.segments.length);
    expect((await callJson(`/api/agreements/${id}/ingestion`, { as: "requester" })).body).toEqual(ready.body);
  });

  it("reruns without duplicate segments or audit events, including concurrent requests", async () => {
    const id = await pendingAgreement();
    const [first, second] = await Promise.all([prepare(id, source), prepare(id, source)]);
    expect(first.status).toBe(200); expect(second.body).toEqual(first.body);
    const count = await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE agreement_id = $1 AND action = 'ingestion.ready'", [id]);
    expect(count.rows[0].count).toBe(1);
  });

  it("retains the agreement on extraction failure and recovers with supplied text", async () => {
    const id = await pendingAgreement();
    const failed = await prepare(id, { version: 1, failed: true });
    expect(failed.body).toMatchObject({ state: "failed", segments: [], text: "" });
    expect(failed.body.error).toMatch(/retry|supply/i);
    expect((await callJson<AgreementDetail>(`/api/agreements/${id}`, { as: "requester" })).status).toBe(200);
    expect((await prepare(id, source)).body.state).toBe("ready");
  });

  it("makes invalid page alignment a recoverable failure rather than a false ready state", async () => {
    const id = await pendingAgreement();
    const failed = await prepare(id, { version: 1, source: "extracted", text: "ABCDE", pageCount: 1, pages: [{ pageNumber: 1, startOffset: 1, endOffset: 5 }] });
    expect(failed.body.state).toBe("failed");
    expect((await prepare(id, source)).body.state).toBe("ready");
  });

  it("retains PDF page locations and rejects fabricated pages for supplied text", async () => {
    const id = await pendingAgreement();
    const text = "Page one\n\nPage two";
    const pages = [{ pageNumber: 1, startOffset: 0, endOffset: 8 }, { pageNumber: 2, startOffset: 10, endOffset: 18 }];
    expect((await prepare(id, { version: 1, source: "supplied", text, pages, pageCount: 2 })).status).toBe(400);
    const ready = await prepare(id, { version: 1, source: "extracted", text, pages, pageCount: 2 });
    expect(ready.body.segments.map((s) => s.pageStart)).toEqual([1, 2]);
  });

  it("prevents cross-user reading and writes and requires authentication", async () => {
    const id = await pendingAgreement();
    expect((await callJson(`/api/agreements/${id}/ingestion`, { as: "stranger" })).status).toBe(404);
    expect((await prepare(id, source, "stranger")).status).toBe(404);
    expect((await callJson(`/api/agreements/${id}/ingestion`)).status).toBe(401);
    expect((await prepare(id, source, "reviewer")).body.state).toBe("ready");
  });

  it("refuses to replace ready source, rejects stale versions, and preserves reviewed evidence", async () => {
    const id = await pendingAgreement();
    await prepare(id, source);
    expect((await prepare(id, { ...source, version: 2 })).status).not.toBe(200);
    expect((await prepare(id, { ...source, text: "Different evidence" })).status).toBe(409);
    const flag = await callJson<AgreementDetail>(`/api/agreements/${id}/findings`, { as: "reviewer", method: "POST", body: {
      category: "Governing Law", findingType: "provision", severity: "low", reason: "Confirmed text", sourceText: "Georgia law applies.", playbookExpectation: "",
    } });
    expect(flag.status).toBe(201);
    expect((await prepare(id, source, "reviewer")).status).toBe(200);
    const preserved = await callJson<AgreementDetail>(`/api/agreements/${id}`, { as: "reviewer" });
    expect(preserved.body.findings[0]?.sourceText).toBe("Georgia law applies.");
    expect(preserved.body.rawText).toBe(source.text);
  });

  it("blocks completion while preparation is pending or failed", async () => {
    const id = await pendingAgreement();
    expect((await callJson(`/api/agreements/${id}/complete`, { as: "approver", method: "POST" })).status).toBe(409);
    expect((await callJson(`/api/agreements/${id}/findings`, { as: "reviewer", method: "POST", body: {
      category: "Governing Law", findingType: "gap", severity: "low", reason: "Not checked yet", sourceText: "", playbookExpectation: "Law clause expected",
    } })).status).toBe(409);
    await prepare(id, { version: 1, failed: true });
    expect((await callJson(`/api/agreements/${id}/complete`, { as: "approver", method: "POST" })).status).toBe(409);
  });

  it("enforces ready-source immutability in the database", async () => {
    const id = await pendingAgreement(); await prepare(id, source);
    await expect(createDatabase(pool as unknown as ConnectionPool).withUser(SEEDED.requesterUser, (db) => db.query(
      "UPDATE agreement_ingestions SET source_text = 'replacement' WHERE agreement_id = $1", [id],
    ))).rejects.toMatchObject({ code: "42501" });
  });
});

it("protects current reviewer notes and audit snapshots in direct requester responses", async () => {
  const initial = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "reviewer" });
  const finding = initial.body.findings[0]!;
  const secret = "Internal assessment: procurement escalation only.";
  const saved = await callJson<AgreementDetail>(`/api/findings/${finding.id}`, { as: "reviewer", method: "PATCH", body: { decision: "accepted", note: secret } });
  expect(saved.status).toBe(200);
  expect(saved.body.findings.find((item) => item.id === finding.id)?.note).toBe(secret);
  const requester = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "requester" });
  expect(requester.status).toBe(200);
  expect(requester.body.findings.every((item) => item.note === "" && item.history.length === 0)).toBe(true);
  expect(JSON.stringify(requester.body)).not.toContain(secret);
  const reviewer = await callJson<AgreementDetail>(`/api/agreements/${SEEDED.newAgreement}`, { as: "reviewer" });
  expect(reviewer.body.findings.find((item) => item.id === finding.id)?.history.at(-1)?.after.note).toBe(secret);
});
