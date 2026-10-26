import type { Agreement, AgreementStatus, RequesterSubmission } from "../types";
import { analyzeAgreement } from "./analyze";
import type { ExtractedDocument } from "./extractText";

const ownerKey = (value: string) => value.trim().toLowerCase();

/** Whether two recorded identities are the same Requester. Blank owns nothing. */
export function sameOwner(left: string, right: string): boolean {
  return Boolean(ownerKey(left)) && ownerKey(left) === ownerKey(right);
}

export function ownsAgreement(agreement: Agreement, requester: string): boolean {
  return sameOwner(requester, agreement.submittedBy ?? "");
}

export function requesterSubmissions(agreements: Agreement[], requester: string): RequesterSubmission[] {
  return agreements.filter((agreement) => ownsAgreement(agreement, requester)).map((agreement) => ({
    id: agreement.id,
    name: agreement.name,
    vendor: agreement.vendor,
    submittedAt: agreement.submittedAt,
    neededBy: agreement.neededBy,
    status: agreement.status,
    currentVersion: agreement.currentVersion,
    versions: (agreement.versions ?? []).map(({ version, fileName, uploadedAt }) => ({ version, fileName, uploadedAt })),
    completedAt: agreement.completedAt,
    conditions: agreement.completedAt ? [...(agreement.conditions ?? [])] : [],
  }));
}

export type ReviewOutcome = Exclude<AgreementStatus, "Needs review" | "In review">;

export function finishReview(agreement: Agreement, outcome: ReviewOutcome, conditions: string, now: string): Agreement {
  if (agreement.findings.some((finding) => finding.decision === "pending")) {
    throw new Error("Review every finding before completing the review.");
  }
  const publicConditions = conditions.split("\n").map((line) => line.trim()).filter(Boolean);
  if (outcome === "Approved with conditions" && !publicConditions.length) {
    throw new Error("Enter the conditions the Requester must meet.");
  }
  if (outcome === "Approved" && publicConditions.length) {
    throw new Error("Choose Approved with conditions or clear the conditions.");
  }
  return { ...agreement, status: outcome, conditions: publicConditions, completedAt: now };
}

export function reviseAgreement(agreement: Agreement, requester: string, fileName: string, document: ExtractedDocument, now: string): Agreement {
  if (!ownsAgreement(agreement, requester)) throw new Error("This submission does not belong to the selected Requester.");
  const previousVersion = agreement.currentVersion ?? 1;
  const versions = agreement.versions?.length ? agreement.versions : [{
    version: previousVersion, fileName: agreement.name, uploadedAt: agreement.submittedAt,
  }];
  return {
    ...agreement,
    currentVersion: previousVersion + 1,
    versions: [...versions, { version: previousVersion + 1, fileName, uploadedAt: now }],
    rawText: document.text,
    pageCount: document.pageCount,
    extractionStrategy: document.strategy,
    extractionWarnings: document.warnings,
    findings: analyzeAgreement(document.text),
    status: "Needs review",
    completedAt: undefined,
    conditions: [],
  };
}
