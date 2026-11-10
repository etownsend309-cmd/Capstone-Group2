import { describe, expect, it } from "vitest";

import { createLocalApi } from "../../scripts/localDevApi";
import { localTestUser } from "../../src/devSession";
import type { AgreementDetail, AgreementSummary } from "../../src/shared/api";

function jsonBody<T>(result: { status: number; json?: unknown; raw?: string }): T {
  if (!("json" in result)) throw new Error("Expected a JSON response.");
  return result.json as T;
}

describe("local development API", () => {
  it("opens a signed-in session and a reviewable agreement with confidence scores", () => {
    const api = createLocalApi();

    const session = api.handle("GET", "/api/session");
    expect(session).toMatchObject({ status: 200, json: { email: localTestUser.email, roles: expect.arrayContaining(["reviewer"]) } });

    const list = api.handle("GET", "/api/agreements");
    expect(list.status).toBe(200);
    const agreements = jsonBody<AgreementSummary[]>(list);
    const reviewable = agreements.find((agreement) => agreement.submittedBy.id !== localTestUser.id);
    expect(reviewable?.name).toBe("Northstar MSA.txt");

    const detail = api.handle("GET", `/api/agreements/${reviewable!.id}`);
    const findings = jsonBody<AgreementDetail>(detail).findings;
    const governingLaw = findings.find((finding) => finding.category === "Governing Law");
    expect(governingLaw).toMatchObject({ method: "local_rule", confidence: 0.98 });
  });
});