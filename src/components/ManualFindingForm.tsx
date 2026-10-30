import { useState, type FormEvent } from "react";
import { playbook } from "../lib/analyze";
import {
    validateManualFinding,
    type ManualFindingField,
    type ManualFindingInput,
} from "../lib/manualFinding";
import type { Finding } from "../types";

export function ManualFindingForm({
    agreementText,
    creator,
    finding,
    onCancel,
    onSave,
}: {
    agreementText: string;
    creator: string;
    finding?: Finding;
    onCancel: () => void;
    onSave: (input: ManualFindingInput) => void;
}) {
    const [input, setInput] = useState<ManualFindingInput>({
        category: finding?.category ?? playbook[0].name,
        findingType: finding?.findingType ?? "Provision",
        severity: finding?.severity ?? "Medium",
        reason: finding?.reason ?? finding?.note ?? "",
        sourceText: finding?.sourceText ?? "",
        playbookExpectation: finding?.playbookExpectation ?? "",
        creator,
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
                            sourceText: findingType === "Gap" ? "" : current.sourceText,
                            playbookExpectation: findingType === "Provision" ? "" : current.playbookExpectation,
                        }));
                        setErrors({});
                    }}>
                        <option>Provision</option>
                        <option>Gap</option>
                    </select>
                    {fieldError("findingType")}
                </label>
                <label>
                    Severity
                    <select id="manual-severity" value={input.severity} aria-invalid={Boolean(errors.severity)} aria-describedby={errors.severity ? "manual-severity-error" : undefined} onChange={(event) => update("severity", event.target.value as ManualFindingInput["severity"])}>
                        <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
                    </select>
                    {fieldError("severity")}
                </label>
                <label>
                    Creator
                    <input id="manual-creator" value={creator} readOnly aria-invalid={Boolean(errors.creator)} aria-describedby={errors.creator ? "manual-creator-error" : undefined} />
                    {fieldError("creator")}
                </label>
            </div>
            {input.findingType === "Provision" ? (
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
                <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
                <button type="submit" className="primary-button">{finding ? "Save changes" : "Create flag"}</button>
            </div>
        </form>
    );
}
