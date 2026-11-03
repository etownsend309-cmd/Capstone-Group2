import { tokenize } from "../../src/pdf/similarity";

const MAX_TOKENS = 6000;

export interface ComparisonMetrics {
  tokenPrecision: number;
  tokenRecall: number;
  tokenF1: number;
  sequenceSimilarity: number;
  expectedTokens: number;
  extractedTokens: number;
}

function lcsLength(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  let previous = new Uint32Array(right.length + 1);
  let current = new Uint32Array(right.length + 1);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] =
        left[leftIndex - 1] === right[rightIndex - 1]
          ? previous[rightIndex - 1] + 1
          : Math.max(previous[rightIndex], current[rightIndex - 1]);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }
  return previous[right.length];
}

export function compareExtraction(expected: string, extracted: string): ComparisonMetrics {
  const expectedTokens = tokenize(expected).slice(0, MAX_TOKENS);
  const extractedTokens = tokenize(extracted).slice(0, MAX_TOKENS);
  const pool = new Map<string, number>();
  for (const token of extractedTokens) pool.set(token, (pool.get(token) ?? 0) + 1);

  let matches = 0;
  for (const token of expectedTokens) {
    const remaining = pool.get(token) ?? 0;
    if (remaining > 0) {
      matches += 1;
      pool.set(token, remaining - 1);
    }
  }

  const tokenPrecision = extractedTokens.length ? matches / extractedTokens.length : 0;
  const tokenRecall = expectedTokens.length ? matches / expectedTokens.length : 0;
  const tokenF1 =
    tokenPrecision + tokenRecall
      ? (2 * tokenPrecision * tokenRecall) / (tokenPrecision + tokenRecall)
      : 0;
  const sequenceSimilarity = expectedTokens.length
    ? lcsLength(expectedTokens, extractedTokens) / expectedTokens.length
    : 0;

  return {
    tokenPrecision,
    tokenRecall,
    tokenF1,
    sequenceSimilarity,
    expectedTokens: expectedTokens.length,
    extractedTokens: extractedTokens.length,
  };
}
