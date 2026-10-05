import { describe, expect, it } from "vitest";
import { demoAgreementText } from "../../src/data";
import { analyzeAgreement, playbook } from "../../src/lib/analyze";

describe("analyzeAgreement", () => {
  it("returns traceable findings for matching playbook categories", () => {
    const text = `This Agreement is governed by the laws of Georgia. The term shall
      automatically renew for successive one-year periods. Vendor will indemnify and
      hold harmless Customer from third-party claims.`;

    const findings = analyzeAgreement(text);

    expect(findings.map((finding) => finding.category)).toEqual([
      "Governing Law",
      "Renewal Term",
    ]);
    expect(findings.every((finding) => finding.sourceText.length > 0)).toBe(true);
    expect(findings.every((finding) => finding.decision === "pending")).toBe(true);
  });

  it("returns no findings for unrelated text", () => {
    expect(analyzeAgreement("This is a short project description.")).toEqual([]);
  });

  it("uses the team's approved 12-category CUAD playbook", () => {
    expect(playbook.map((category) => category.name)).toEqual([
      "Governing Law",
      "Anti-Assignment",
      "Cap On Liability",
      "Audit Rights",
      "Termination For Convenience",
      "Exclusivity",
      "Renewal Term",
      "Insurance",
      "Change Of Control",
      "Uncapped Liability",
      "Notice Period To Terminate Renewal",
      "Warranty Duration",
    ]);
  });

  it("finds all approved categories in the demo without creating an indemnification category", () => {
    const categories = analyzeAgreement(demoAgreementText).map((finding) => finding.category);

    expect(categories).toEqual(playbook.map((category) => category.name));
    expect(categories).not.toContain("Indemnification");
  });
});
