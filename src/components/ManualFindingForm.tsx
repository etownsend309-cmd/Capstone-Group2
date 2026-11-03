import { useState, type FormEvent } from "react";
import { playbook } from "../lib/analyze";
import { validateManualFinding, type ManualFindingField } from "../lib/manualFinding";
import {
    FINDING_SEVERITIES,
    FINDING_TYPES,
    FINDING_TYPE_LABELS,
    SEVERITY_LABELS,
    type FindingRecord,
    type ManualFindingInput,
} from "../shared/api";

/**
 * Creates or edits a manual flag. The rules shown here are checked again by
 * the API, which also records who made the flag and every later change.
 */
export function ManualFindingForm({
    agreementText,
    creator,
    finding,
    busy = false,
    onCancel,
    onSave,
}: {
    agreementText: string;
    /** Shown read-only: the flag's creator, or the person creating it. */
    creator: string;
    finding?: FindingRecord;
    busy?: boolean;
    onCancel: () => void;
    onSave: (input: ManualFindingInput) => void;
}) {
    const [input, setInput] = useState<ManualFindingInput>({
        category: finding?.category ?? playbook[0].name,
        findingType: finding?.findingType ?? "provision",
        severity: finding?.severity ?? "medium",
        reason: finding?.reason || finding?.note || "",
        sourceText: finding?.sourceText ?? "",
        playbookExpectation: finding?.playbookExpectation ?? "",
    });
    const [errors, setErrors] = useState<Partial<Record<ManualFindingField, string>>>({});

    const update = <K extends ManualFindingField>(field: K, value: ManualFindingInput[K]) => {
        setInput((current) => ({ ...current, [field]: value }));
    };

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const nextErrors = validateManualFinding(input, agreementText);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) {
            const firstInvalid = Object.keys(nextErrors)[0];
            document.getElementById(`manual-${firstInvalid}`)?.focus();
            return;
        }
        onSave(input);
    };

    const fieldError = (field: ManualFindingField) => errors[field] ? (
        <small className="error-message" id={`manual-${field}-error`}>{errors[field]}</small>
    ) : null;

    return (
        <form className="manual-finding-form" onSubmit={submit} noValidate>
            <div className="finding-title"><div><span className="eyebrow">Manual origin</span><h3>{finding ? "Edit manual flag" : "Add manual flag"}</h3></div></div>
            <div className="manual-form-grid">
                <label>
                    Playbook category
                    <select id="manual-category" value={input.category} aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? "manual-category-error" : undefined} onChange={(event) => update("category", event.target.value)}>
                        {playbook.map((category) => <option key={category.name}>{category.name}</option>)}
                    </select>
                    {fieldError("category")}
                </label>
                <label>
                    Finding type
                    <select id="manual-findingType" value={input.findingType} aria-invalid={Boolean(errors.findingType)} aria-describedby={errors.findingType ? "manual-findingType-error" : undefined} onChange={(event) => {
                        const findingType = event.target.value as ManualFindingInput["findingType"];
                        setInput((current) => ({
                            ...current,
                            findingType,
                            sourceText: findingType === "gap" ? "" : current.sourceText,
                            playbookExpectation: findingType === "provision" ? "" : current.playbookExpectation,
                        }));
                        setErrors({});
                    }}>
                        {FINDING_TYPES.map((type) => <option key={type} value={type}>{FINDING_TYPE_LABELS[type]}</option>)}
                    </select>
                    {fieldError("findingType")}
                </label>
                <label>
                    Severity
                    <select id="manual-severity" value={input.severity} aria-invalid={Boolean(errors.severity)} aria-describedby={errors.severity ? "manual-severity-error" : undefined} onChange={(event) => update("severity", event.target.value as ManualFindingInput["severity"])}>
                        {FINDING_SEVERITIES.map((severity) => <option key={severity} value={severity}>{SEVERITY_LABELS[severity]}</option>)}
                    </select>
                    {fieldError("severity")}
                </label>
                <label>
                    Creator
                    <input id="manual-creator" value={creator} readOnly />
                </label>
            </div>
            {input.findingType === "provision" ? (
                <label className="manual-form-field">
                    Exact supporting source text
                    <textarea id="manual-sourceText" value={input.sourceText} aria-invalid={Boolean(errors.sourceText)} aria-describedby={errors.sourceText ? "manual-sourceText-error" : undefined} onChange={(event) => update("sourceText", event.target.value)} placeholder="Paste the exact text from the agreement" />
                    {fieldError("sourceText")}
                </label>
            ) : (
                <>
                    <p className="gap-evidence-note">Gap finding: no contract text is cited.</p>
                    <label className="manual-form-field">
                        Applicable playbook expectation
                        <textarea id="manual-playbookExpectation" value={input.playbookExpectation} aria-invalid={Boolean(errors.playbookExpectation)} aria-describedby={errors.playbookExpectation ? "manual-playbookExpectation-error" : undefined} onChange={(event) => update("playbookExpectation", event.target.value)} placeholder="State the applicable expectation from the playbook" />
                        {fieldError("playbookExpectation")}
                    </label>
                </>
            )}
            <label className="manual-form-field">
                Reason
                <textarea id="manual-reason" value={input.reason} aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? "manual-reason-error" : undefined} onChange={(event) => update("reason", event.target.value)} placeholder="Explain why this provision or gap should be flagged" />
                {fieldError("reason")}
            </label>
            <div className="manual-form-actions">
                <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
                <button type="submit" className="primary-button" disabled={busy}>{finding ? "Save changes" : "Create flag"}</button>
            </div>
        </form>
    );
}
