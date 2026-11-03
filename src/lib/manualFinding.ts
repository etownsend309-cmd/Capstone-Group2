/**
 * Rules for manual flags, shared by the review screen (for early feedback)
 * and the API (which enforces them). Creating a flag, editing it and keeping
 * its history now happen on the server; see server/services/agreements.ts.
 */

import { FINDING_SEVERITIES, FINDING_TYPES, type ManualFindingInput } from "../shared/api";
import { playbook } from "./analyze";

export type ManualFindingField = keyof ManualFindingInput;
export type ManualFindingErrors = Partial<Record<ManualFindingField, string>>;

/** Checks a manual flag against the agreement it belongs to. An empty result means it is valid. */
export function validateManualFinding(input: ManualFindingInput, agreementText: string): ManualFindingErrors {
  const errors: ManualFindingErrors = {};
  if (!playbook.some((category) => category.name === input.category)) {
    errors.category = "Choose a playbook category.";
  }
  if (!FINDING_TYPES.includes(input.findingType)) {
    errors.findingType = "Choose a finding type.";
  }
  if (!FINDING_SEVERITIES.includes(input.severity)) {
    errors.severity = "Choose a severity.";
  }
  if (typeof input.reason !== "string" || !input.reason.trim()) {
    errors.reason = "Enter a reason.";
  }

  const sourceText = typeof input.sourceText === "string" ? input.sourceText : "";
  const expectation = typeof input.playbookExpectation === "string" ? input.playbookExpectation : "";
  if (input.findingType === "provision") {
    if (!sourceText.trim()) {
      errors.sourceText = "Enter exact supporting text from the agreement.";
    } else if (!agreementText.includes(sourceText)) {
      errors.sourceText = "Supporting text must match text in the agreement exactly.";
    }
    if (expectation.trim()) {
      errors.playbookExpectation = "Provision findings do not use a gap expectation.";
    }
  } else if (input.findingType === "gap") {
    if (!expectation.trim()) {
      errors.playbookExpectation = "Reference the applicable playbook expectation.";
    }
    if (sourceText.trim()) {
      errors.sourceText = "Gap findings cannot include invented contract text.";
    }
  }
  return errors;
}

/** The input with only the fields its type uses, and the reason trimmed. */
export function normalizeManualFinding(input: ManualFindingInput): ManualFindingInput {
  return {
    category: input.category,
    findingType: input.findingType,
    severity: input.severity,
    reason: input.reason.trim(),
    sourceText: input.findingType === "provision" ? input.sourceText : "",
    playbookExpectation: input.findingType === "gap" ? input.playbookExpectation.trim() : "",
  };
}
