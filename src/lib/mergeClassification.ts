import { supplementWithLocalAnalysis } from "./analyze";
import type { Finding } from "../types";

export interface ClassificationPlan {
  /** Existing rows left unchanged. */
  keptIds: string[];
  /** Existing rows whose content is replaced by a new finding. */
  replacements: { id: string; finding: Finding }[];
  /** Findings that do not yet have a row. */
  inserts: Finding[];
}

function replaceable(finding: Finding): boolean {
  return (
    (finding.method === "Local rule" || finding.method === "AI") &&
    finding.decision === "pending" &&
    !finding.note.trim() &&
    !(finding.history?.length)
  );
}

/**
 * Combines a classifier result with the findings already stored.
 *
 * Human decisions, notes, manual flags, and history stay. Untouched local-rule
 * or AI rows in a category the model returned are replaced. Categories the
 * model did not return keep their local-rule coverage, and a failed call with
 * findings already stored changes nothing.
 */
export function planClassification(text: string, existing: Finding[], incomingAi: Finding[]): ClassificationPlan {
  if (incomingAi.length === 0 && existing.length > 0) {
    return { keptIds: existing.map((finding) => finding.id), replacements: [], inserts: [] };
  }

  const incomingCategories = new Set(incomingAi.map((finding) => finding.category));
  const preserved = existing.filter((finding) => !incomingCategories.has(finding.category) || !replaceable(finding));
  const preservedIds = new Set(preserved.map((finding) => finding.id));
  const represented = new Set(preserved.map((finding) => finding.category));
  const additions = incomingAi.filter((finding) => !represented.has(finding.category));
  const desired = supplementWithLocalAnalysis(text, [...preserved, ...additions]);

  const replacedByCategory = new Map<string, Finding>();
  for (const finding of existing) {
    if (!preservedIds.has(finding.id) && !replacedByCategory.has(finding.category)) {
      replacedByCategory.set(finding.category, finding);
    }
  }

  const keptIds: string[] = [];
  const replacements: ClassificationPlan["replacements"] = [];
  const inserts: Finding[] = [];
  for (const finding of desired) {
    if (preservedIds.has(finding.id)) {
      keptIds.push(finding.id);
      continue;
    }
    const previous = replacedByCategory.get(finding.category);
    if (previous) {
      replacements.push({ id: previous.id, finding });
      replacedByCategory.delete(finding.category);
    } else {
      inserts.push(finding);
    }
  }
  return { keptIds, replacements, inserts };
}
