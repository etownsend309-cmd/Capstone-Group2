import {
  APPROVED_CATEGORIES,
  type ApprovedCategory,
  type FindingRejection,
  type ModelFindingV1,
  type ValidatedAiFinding,
} from "../../../src/shared/classifier.js";
import { MAX_QUOTE_CHARACTERS } from "./classifierSchema.js";

const approved = new Set<string>(APPROVED_CATEGORIES);

function occurrences(text: string, quote: string): number[] {
  const matches: number[] = [];
  let from = 0;
  while (from <= text.length - quote.length) {
    const index = text.indexOf(quote, from);
    if (index === -1) break;
    matches.push(index);
    from = index + 1;
  }
  return matches;
}

function contextMatches(
  documentText: string,
  quote: string,
  index: number,
  leftContext: string | null,
  rightContext: string | null,
): boolean {
  const leftMatches =
    !leftContext ||
    documentText.slice(Math.max(0, index - leftContext.length), index) === leftContext;
  const quoteEnd = index + quote.length;
  const rightMatches =
    !rightContext ||
    documentText.slice(quoteEnd, quoteEnd + rightContext.length) === rightContext;
  return leftMatches && rightMatches;
}

export function validateSourceQuotes(
  documentText: string,
  findings: readonly ModelFindingV1[],
): { findings: ValidatedAiFinding[]; rejections: FindingRejection[] } {
  const validated: ValidatedAiFinding[] = [];
  const rejections: FindingRejection[] = [];
  const categoryCounts = new Map<string, number>();

  for (const finding of findings) {
    categoryCounts.set(finding.category, (categoryCounts.get(finding.category) ?? 0) + 1);
  }
  const rejectedDuplicateCategories = new Set<string>();

  for (const finding of findings) {
    if (!approved.has(finding.category)) {
      rejections.push({ reason: "invalid_category" });
      continue;
    }
    const category = finding.category as ApprovedCategory;
    if ((categoryCounts.get(category) ?? 0) > 1) {
      if (!rejectedDuplicateCategories.has(category)) {
        rejections.push({ category, reason: "duplicate_category" });
        rejectedDuplicateCategories.add(category);
      }
      continue;
    }
    if (!finding.quote.trim()) {
      rejections.push({ category, reason: "empty_quote" });
      continue;
    }
    if (finding.quote.length > MAX_QUOTE_CHARACTERS) {
      rejections.push({ category, reason: "quote_too_long" });
      continue;
    }

    const exactMatches = occurrences(documentText, finding.quote);
    if (exactMatches.length === 0) {
      rejections.push({ category, reason: "unmatched_quote" });
      continue;
    }
    const contextualMatches = exactMatches.filter((index) =>
      contextMatches(
        documentText,
        finding.quote,
        index,
        finding.leftContext,
        finding.rightContext,
      ),
    );
    const candidates = exactMatches.length === 1 ? exactMatches : contextualMatches;
    if (candidates.length !== 1) {
      rejections.push({ category, reason: "ambiguous_quote" });
      continue;
    }

    const sourceStart = candidates[0];
    const sourceEnd = sourceStart + finding.quote.length;
    if (documentText.slice(sourceStart, sourceEnd) !== finding.quote) {
      rejections.push({ category, reason: "unmatched_quote" });
      continue;
    }
    validated.push({
      category,
      sourceText: finding.quote,
      sourceStart,
      sourceEnd,
      confidenceIndicator: finding.confidenceIndicator,
      evidenceValidation: "exact",
    });
  }

  return { findings: validated, rejections };
}
