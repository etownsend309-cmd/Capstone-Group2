import { playbook } from "./analyze";
import type {
    Finding,
    FindingAuditSnapshot,
    FindingType,
    FindingSeverity,
} from "../types";

export interface ManualFindingInput {
    category: string;
    findingType: FindingType;
    severity: FindingSeverity;
    reason: string;
    sourceText: string;
    playbookExpectation: string;
    creator: string;
}

export type ManualFindingField = keyof ManualFindingInput;

export function validateManualFinding(
    input: ManualFindingInput,
    agreementText: string,
): Partial<Record<ManualFindingField, string>> {
    const errors: Partial<Record<ManualFindingField, string>> = {};
    if (!playbook.some((category) => category.name === input.category)) {
        errors.category = "Choose a playbook category.";
    }
    if (!(["Provision", "Gap"] as string[]).includes(input.findingType)) {
        errors.findingType = "Choose a finding type.";
    }

    if (!(["Low", "Medium", "High", "Critical"] as string[]).includes(input.severity)) {
        errors.severity = "Choose a severity.";
    }
    if (!input.reason.trim()) {
        errors.reason = "Enter a reason.";
    }

    if (!input.creator.trim()) {
        errors.creator = "A creator is required.";
    }

if (input.findingType === "Provision") {
    if (!input.sourceText.trim()) {
        errors.sourceText = "Enter exact supporting text from the agreement.";
    } else if (!agreementText.includes(input.sourceText)) {
        errors.sourceText = "Supporting text must match text in the agreement exactly.";
    }
    if (input.playbookExpectation.trim()) {
        errors.playbookExpectation = "Provision findings do not use a gap expectation.";
    }
} else if (input.findingType === "Gap") {
    if (!input.playbookExpectation.trim()) {
        errors.playbookExpectation = "Reference the applicable playbook expectation.";
    }
    if (input.sourceText.trim()) {
        errors.sourceText = "Gap findings cannot include invented contract text.";
    }
}
    return errors;
}

export function findingSnapshot(finding: Finding): FindingAuditSnapshot {
    return {
        category: finding.category,
        findingType: finding.findingType,
        severity: finding.severity,
        reason: finding.reason,
        note: finding.note,
        sourceText: finding.sourceText,
        playbookExpectation: finding.playbookExpectation,
        decision: finding.decision,
    };
}

export function createManualFinding(input: ManualFindingInput): Finding {
    const finding: Finding = {
        id: crypto.randomUUID(),
        category: input.category,
        confidence: 1,
        sourceText: input.findingType === "Provision" ? input.sourceText : "",
        decision: "pending",
        note: input.reason,
        method: "Manual",
        findingType: input.findingType,
        severity: input.severity,
        reason: input.reason,
        creator: input.creator,
        playbookExpectation: input.findingType === "Gap" ? input.playbookExpectation : "",
    };
    finding.history = [{
        action: "created",
        actor: input.creator,
        at: new Date().toISOString(),
        after: findingSnapshot(finding),
    }];
    return finding;
}

export function auditFindingUpdate(
    current: Finding,
    patch: Partial<Finding>,
    actor: string,
): Finding {
    const updated = { ...current, ...patch };
    const before = findingSnapshot(current);
    const after = findingSnapshot(updated);
    if (JSON.stringify(before) === JSON.stringify(after)) {
        return current;
    }

    return {
        ...updated,
        history: [
            ...(current.history ?? []),
            {
                action: patch.decision && patch.decision !== current.decision ? "decision" : "edited",
                actor,
                at: new Date().toISOString(),
                before,
                after,
            },
        ],
    };
}