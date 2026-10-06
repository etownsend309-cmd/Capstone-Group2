/**
 * Ground-truth comparison for the fixtures that ship an expected `.txt`.
 *
 * Two numbers are always reported together, on purpose:
 *
 *   - `tokenCoverage` asks "did we get the words?" (order independent)
 *   - `sequenceSimilarity` asks "did we get them in the right order?"
 *
 * High coverage with low sequence similarity is the signature of a
 * reading-order problem, such as two columns read across the gutter. Reporting
 * coverage alone would hide exactly the failure this POC exists to find, which
 * is also why the benchmark never ranks a strategy on character count.
 */

import { normalizeForComparison } from "./evaluateExtraction";

/** Guard rail so a pathological document cannot lock up the process. */
const MAX_TOKENS = 6000;

/** Below this gap, order is considered materially wrong. A documented POC choice. */
export const READING_ORDER_SUSPECT_GAP = 0.15;

export interface SimilarityScore {
  /** Fraction of expected tokens present in the output, ignoring order. 0-1. */
  tokenCoverage: number;
  /** Order-sensitive longest-common-subsequence ratio over tokens. 0-1. */
  sequenceSimilarity: number;
  expectedTokens: number;
  extractedTokens: number;
  /** True when the words are nearly all there but the order is not. */
  readingOrderSuspect: boolean;
}

export function tokenize(text: string): string[] {
  return normalizeForComparison(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}$%.,()"'-]+/u)
    .map((token) => token.replace(/^[.,'"()-]+|[.,'"()-]+$/g, ""))
    .filter((token) => token.length > 0);
}

/** Length of the longest common subsequence of two token arrays. */
function lcsLength(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let previous = new Uint32Array(b.length + 1);
  let current = new Uint32Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    const swap = previous;
    previous = current;
    current = swap;
    current.fill(0);
  }
  return previous[b.length];
}

export function compareToGroundTruth(expected: string, extracted: string): SimilarityScore {
  const expectedTokens = tokenize(expected).slice(0, MAX_TOKENS);
  const extractedTokens = tokenize(extracted).slice(0, MAX_TOKENS);

  if (expectedTokens.length === 0) {
    return {
      tokenCoverage: 0,
      sequenceSimilarity: 0,
      expectedTokens: 0,
      extractedTokens: extractedTokens.length,
      readingOrderSuspect: false,
    };
  }

  // Multiset coverage: how many expected tokens are accounted for anywhere.
  const pool = new Map<string, number>();
  for (const token of extractedTokens) {
    pool.set(token, (pool.get(token) ?? 0) + 1);
  }
  let matched = 0;
  for (const token of expectedTokens) {
    const remaining = pool.get(token) ?? 0;
    if (remaining > 0) {
      pool.set(token, remaining - 1);
      matched += 1;
    }
  }

  const tokenCoverage = matched / expectedTokens.length;
  const sequenceSimilarity = lcsLength(expectedTokens, extractedTokens) / expectedTokens.length;

  return {
    tokenCoverage,
    sequenceSimilarity,
    expectedTokens: expectedTokens.length,
    extractedTokens: extractedTokens.length,
    readingOrderSuspect: tokenCoverage - sequenceSimilarity > READING_ORDER_SUSPECT_GAP,
  };
}
