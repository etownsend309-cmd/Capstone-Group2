import type {
  ApprovedCategory,
  ConfidenceIndicator,
} from "../../src/shared/classifier.js";

export interface CategoryPrediction {
  category: ApprovedCategory;
  confidenceIndicator?: ConfidenceIndicator;
}

export interface EvaluationCase {
  id: string;
  expected: ApprovedCategory[];
  predicted: CategoryPrediction[];
  acceptedEvidence: number;
  rejectedEvidence: number;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  failed?: boolean;
}

export interface CategoryMetrics {
  category: ApprovedCategory;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[midpoint - 1] + ordered[midpoint]) / 2
    : ordered[midpoint];
}

export function calculateCategoryMetrics(
  categories: readonly ApprovedCategory[],
  cases: readonly EvaluationCase[],
): CategoryMetrics[] {
  return categories.map((category) => {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    for (const item of cases) {
      const expected = item.expected.includes(category);
      const predicted = item.predicted.some((entry) => entry.category === category);
      if (expected && predicted) truePositives += 1;
      else if (!expected && predicted) falsePositives += 1;
      else if (expected) falseNegatives += 1;
    }
    const precision = ratio(truePositives, truePositives + falsePositives);
    const recall = ratio(truePositives, truePositives + falseNegatives);
    return {
      category,
      truePositives,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    };
  });
}

export function summarizeEvaluation(
  categories: readonly ApprovedCategory[],
  cases: readonly EvaluationCase[],
) {
  const perCategory = calculateCategoryMetrics(categories, cases);
  const totalEvidence = cases.reduce(
    (total, item) => total + item.acceptedEvidence + item.rejectedEvidence,
    0,
  );
  return {
    documents: cases.length,
    failures: cases.filter((item) => item.failed).length,
    macroPrecision: ratio(
      perCategory.reduce((total, item) => total + item.precision, 0),
      perCategory.length,
    ),
    macroRecall: ratio(
      perCategory.reduce((total, item) => total + item.recall, 0),
      perCategory.length,
    ),
    macroF1: ratio(
      perCategory.reduce((total, item) => total + item.f1, 0),
      perCategory.length,
    ),
    exactEvidenceAcceptanceRate: ratio(
      cases.reduce((total, item) => total + item.acceptedEvidence, 0),
      totalEvidence,
    ),
    medianLatencyMs: median(
      cases.flatMap((item) => (item.latencyMs === undefined ? [] : [item.latencyMs])),
    ),
    totalInputTokens: cases.reduce((total, item) => total + (item.inputTokens ?? 0), 0),
    totalOutputTokens: cases.reduce((total, item) => total + (item.outputTokens ?? 0), 0),
    perCategory,
  };
}
