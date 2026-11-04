import { describe, expect, it } from "vitest";
import { demoAgreementText } from "../../src/data";
import { analyzeAgreement, playbook } from "../../src/lib/analyze";

describe("analyzeAgreement", () => {
  it("returns traceable findings for matching playbook categories", () => {
    const text = `This Agreement is governed by the laws of Georgia. The term shall
      automatically renew for successive one-year periods. Vendor will indemnify and
      hold harmless Customer from third-party claims.`;

    const findings = analyzeAgreement(text);

    expect(findings.filter((finding) => finding.classification === "present").map((finding) => finding.category)).toEqual([
      "Governing Law",
      "Renewal Term",
    ]);
    expect(findings.filter((finding) => finding.findingType === "Provision").every((finding) => finding.sourceText.length > 0)).toBe(true);
    expect(findings.every((finding) => finding.decision === "pending")).toBe(true);
  });

  it("creates gaps for applicable expectations only after a completed text search", () => {
    const findings = analyzeAgreement("This is a short project description.");
    const gap = findings.find((finding) => finding.category === "Governing Law");

    expect(gap).toMatchObject({
      findingType: "Gap",
      classification: "gap",
      severity: "Medium",
      confidence: 0.72,
      sourceText: "",
      playbookExpectation: "The agreement identifies its governing law and jurisdiction.",
    });
    expect(gap?.reason).toContain("completed stored agreement text was searched");
  });

  it("does not create gaps when agreement text is empty after extraction failure", () => {
    expect(analyzeAgreement("  \n ")).toEqual([]);
  });

  it("treats a present provision as a provision rather than a gap", () => {
    const finding = analyzeAgreement("Governing law is specified as New York.")
      .find((item) => item.category === "Governing Law");

    expect(finding).toMatchObject({ findingType: "Provision", classification: "present" });
    expect(finding?.sourceText).toContain("Governing law is specified as New York.");
  });

  it("classifies a present clause that misses a configured standard as a deviation", () => {
    const rule = {
      ...playbook[0],
      standardPatterns: [/governed by the laws of New York/i],
    };
    const finding = analyzeAgreement("Governing law is governed by the laws of California.", [rule])
      .find((item) => item.category === rule.name);

    expect(finding).toMatchObject({ findingType: "Provision", classification: "deviation" });
    expect(finding?.reason).toContain("deviation, not an omission");
  });

  it("does not call an uncertain classification a gap", () => {
    const finding = analyzeAgreement("The agreement refers to a jurisdiction, but leaves it unclear.")
      .find((item) => item.category === "Governing Law");

    expect(finding).toMatchObject({ findingType: "Provision", classification: "uncertain", confidence: 0.45 });
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
