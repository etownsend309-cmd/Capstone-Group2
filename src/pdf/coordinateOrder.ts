/**
 * Strategy B: coordinate-based reconstruction.
 *
 * PDF.js gives every text fragment a position and size. This strategy ignores
 * the order the fragments arrived in and rebuilds reading order from geometry:
 *
 *   1. Group fragments into lines by their vertical position.
 *   2. Look for a vertical gutter - a band of the page that no fragment
 *      overlaps - to decide whether the page is one column or two.
 *   3. Classify each line as left column, right column, or full width
 *      (a heading or rule that spans the gutter).
 *   4. Walk the page top to bottom. Full-width lines are emitted where they
 *      occur; column lines are buffered and flushed left column first, then
 *      right column, whenever a full-width line interrupts them or the page
 *      ends.
 *
 * This is an experiment, not a production layout engine. Known limitations are
 * listed at the bottom of this file and in docs/pdf-extraction-poc.md.
 *
 * Both strategies read the same PDF.js output. They compare *reconstruction
 * approaches*, not independent PDF engines.
 */

import { collapseBlankRuns } from "./contentOrder";
import type { TextFragment } from "./types";

export interface CoordinateOptions {
  /**
   * Two fragments belong to the same line when their vertical centres differ by
   * less than this fraction of the median glyph height.
   */
  lineToleranceRatio: number;
  /** A candidate gutter must be at least this fraction of the content width. */
  minGutterRatio: number;
  /** A gutter must sit within this central portion of the content width. */
  gutterCentreBand: [number, number];
  /** Each column must hold at least this fraction of all lines. */
  minColumnShare: number;
  /**
   * A gutter band may still be crossed by a full-width heading. Allow this
   * fraction of lines to overlap it before rejecting the band.
   */
  maxGutterLineCoverage: number;
  /** Insert a space between fragments separated by more than this × height. */
  spaceGapRatio: number;
}

export const DEFAULT_COORDINATE_OPTIONS: CoordinateOptions = {
  lineToleranceRatio: 0.6,
  // 1.2% of the text width. Real two-column documents use narrow gutters:
  // LaTeX's default \columnsep of 10pt is about 2% of a typical text width, so
  // anything stricter misses them. Narrow bands are safe because the real
  // defence against a false positive is maxGutterLineCoverage below - a gap
  // between words is clear on one line, not on 40 of them.
  minGutterRatio: 0.012,
  gutterCentreBand: [0.25, 0.75],
  minColumnShare: 0.15,
  maxGutterLineCoverage: 0.15,
  spaceGapRatio: 0.2,
};

export interface Line {
  /** Vertical centre of the line in PDF user space. */
  y: number;
  left: number;
  right: number;
  fragments: TextFragment[];
}

/**
 * Number of bins used to scan the page for an empty vertical band. Fine enough
 * to resolve a gutter of ~1% of the text width into several bins.
 */
const OCCUPANCY_BINS = 600;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Drop fragments that carry no characters at all; keep everything else. */
export function usableFragments(fragments: TextFragment[]): TextFragment[] {
  return fragments.filter((fragment) => fragment.text.length > 0);
}

/**
 * Group fragments into lines by vertical position.
 * PDF user space has y increasing upward, so lines come back top-first.
 */
export function groupIntoLines(
  fragments: TextFragment[],
  options: CoordinateOptions = DEFAULT_COORDINATE_OPTIONS,
): Line[] {
  const items = usableFragments(fragments);
  if (items.length === 0) return [];

  const typicalHeight = median(items.map((f) => f.height).filter((h) => h > 0)) || 10;
  const tolerance = typicalHeight * options.lineToleranceRatio;

  const byY = [...items].sort((a, b) => b.y - a.y);
  const lines: Line[] = [];

  for (const fragment of byY) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - fragment.y) <= tolerance) {
      current.fragments.push(fragment);
      current.left = Math.min(current.left, fragment.x);
      current.right = Math.max(current.right, fragment.x + fragment.width);
      // Track the running mean so a tall glyph does not drag the line's anchor.
      current.y =
        (current.y * (current.fragments.length - 1) + fragment.y) / current.fragments.length;
    } else {
      lines.push({
        y: fragment.y,
        left: fragment.x,
        right: fragment.x + fragment.width,
        fragments: [fragment],
      });
    }
  }

  for (const line of lines) {
    line.fragments.sort((a, b) => a.x - b.x);
  }
  return lines;
}

/** Join one line's fragments, inserting spaces where the geometry implies a gap. */
export function lineToText(
  line: Line,
  options: CoordinateOptions = DEFAULT_COORDINATE_OPTIONS,
): string {
  return fragmentsToText(line.fragments, options);
}

/** Join fragments already known to sit on the same line, left to right. */
export function fragmentsToText(
  fragments: TextFragment[],
  options: CoordinateOptions = DEFAULT_COORDINATE_OPTIONS,
): string {
  let out = "";
  let previousRight: number | null = null;
  let previousHeight = 0;

  for (const fragment of fragments) {
    if (previousRight !== null) {
      const gap = fragment.x - previousRight;
      const reference = Math.max(previousHeight, fragment.height, 1);
      const needsSpace =
        gap > reference * options.spaceGapRatio &&
        !/\s$/.test(out) &&
        !/^\s/.test(fragment.text);
      if (needsSpace) out += " ";
    }
    out += fragment.text;
    previousRight = fragment.x + fragment.width;
    previousHeight = fragment.height;
  }
  return out.trim();
}

export interface GutterDetection {
  /** True when the page looks like two columns separated by an empty band. */
  found: boolean;
  /** Horizontal centre of the gutter in PDF user space. */
  centre: number;
  start: number;
  end: number;
  contentLeft: number;
  contentRight: number;
}

/**
 * Scan for a vertical band that almost no line of text crosses.
 *
 * Coverage is measured per line rather than per fragment. That matters: a
 * centred full-width heading sits right on top of the gutter, so a strict
 * "no fragment may touch this band" test would never find a gutter on a page
 * that has a title. Allowing a small fraction of lines to cross keeps headings
 * from hiding the column break.
 *
 * Three further checks stop an ordinary paragraph indent from being mistaken
 * for a column break: the band must be reasonably wide, sit near the middle of
 * the content, and have a real share of the page's lines on each side.
 */
export function detectColumnGutter(
  fragments: TextFragment[],
  options: CoordinateOptions = DEFAULT_COORDINATE_OPTIONS,
): GutterDetection {
  const items = usableFragments(fragments).filter((f) => f.text.trim().length > 0);
  const miss: GutterDetection = {
    found: false,
    centre: 0,
    start: 0,
    end: 0,
    contentLeft: 0,
    contentRight: 0,
  };
  if (items.length < 8) return miss;

  const contentLeft = Math.min(...items.map((f) => f.x));
  const contentRight = Math.max(...items.map((f) => f.x + f.width));
  const contentWidth = contentRight - contentLeft;
  if (contentWidth <= 0) return miss;

  const lines = groupIntoLines(items, options);
  if (lines.length < 4) return miss;

  const binWidth = contentWidth / OCCUPANCY_BINS;
  const linesCovering = new Uint32Array(OCCUPANCY_BINS);
  for (const line of lines) {
    const touched = new Set<number>();
    for (const fragment of line.fragments) {
      if (fragment.text.trim().length === 0) continue;
      const from = Math.max(0, Math.floor((fragment.x - contentLeft) / binWidth));
      const to = Math.min(
        OCCUPANCY_BINS - 1,
        Math.ceil((fragment.x + fragment.width - contentLeft) / binWidth),
      );
      for (let bin = from; bin <= to; bin += 1) touched.add(bin);
    }
    for (const bin of touched) linesCovering[bin] += 1;
  }

  // Always tolerate at least one crossing line. On a short page a single
  // centred heading is more than 15% of the lines, and rejecting the band for
  // that would mean never finding a gutter on a page that has a title.
  const maxLines = Math.max(1, lines.length * options.maxGutterLineCoverage);
  const isClear = (bin: number) => linesCovering[bin] <= maxLines;

  // Widest run of clear bins that does not touch either edge.
  let best = { start: -1, end: -1, length: 0 };
  let runStart = -1;
  for (let bin = 0; bin <= OCCUPANCY_BINS; bin += 1) {
    const clear = bin < OCCUPANCY_BINS && isClear(bin);
    if (clear && runStart === -1) {
      runStart = bin;
    } else if (!clear && runStart !== -1) {
      const length = bin - runStart;
      if (runStart > 0 && bin < OCCUPANCY_BINS && length > best.length) {
        best = { start: runStart, end: bin, length };
      }
      runStart = -1;
    }
  }
  if (best.length === 0) return miss;

  const start = contentLeft + best.start * binWidth;
  const end = contentLeft + best.end * binWidth;
  const centre = (start + end) / 2;

  const wideEnough = (end - start) / contentWidth >= options.minGutterRatio;
  const relativeCentre = (centre - contentLeft) / contentWidth;
  const [bandLow, bandHigh] = options.gutterCentreBand;
  const centredEnough = relativeCentre >= bandLow && relativeCentre <= bandHigh;

  const leftLines = lines.filter((line) =>
    line.fragments.some((f) => f.text.trim() && f.x + f.width <= centre),
  ).length;
  const rightLines = lines.filter((line) =>
    line.fragments.some((f) => f.text.trim() && f.x >= centre),
  ).length;
  const balanced =
    leftLines / lines.length >= options.minColumnShare &&
    rightLines / lines.length >= options.minColumnShare;

  if (!wideEnough || !centredEnough || !balanced) return miss;
  return { found: true, centre, start, end, contentLeft, contentRight };
}

/** Rebuild one page's text from fragment geometry. */
export function reconstructCoordinateOrder(
  fragments: TextFragment[],
  options: CoordinateOptions = DEFAULT_COORDINATE_OPTIONS,
): string {
  const lines = groupIntoLines(fragments, options);
  if (lines.length === 0) return "";

  const gutter = detectColumnGutter(fragments, options);
  if (!gutter.found) {
    return collapseBlankRuns(lines.map((line) => lineToText(line, options)).join("\n"));
  }

  const out: string[] = [];
  let leftBuffer: string[] = [];
  let rightBuffer: string[] = [];

  const flushColumns = () => {
    if (leftBuffer.length > 0) out.push(...leftBuffer);
    if (rightBuffer.length > 0) out.push(...rightBuffer);
    leftBuffer = [];
    rightBuffer = [];
  };

  for (const line of lines) {
    // A fragment that physically overlaps the gutter is a heading or rule that
    // spans both columns. A line whose fragments merely sit on both sides of
    // the gutter is one visual row of a two-column layout and must be split,
    // otherwise the two columns stay interleaved.
    const crosses = line.fragments.some(
      (fragment) =>
        fragment.text.trim().length > 0 &&
        fragment.x < gutter.centre &&
        fragment.x + fragment.width > gutter.centre,
    );

    if (crosses) {
      flushColumns();
      const text = lineToText(line, options);
      if (text.length > 0) out.push(text);
      continue;
    }

    const leftText = fragmentsToText(
      line.fragments.filter((fragment) => fragment.x + fragment.width <= gutter.centre),
      options,
    );
    const rightText = fragmentsToText(
      line.fragments.filter((fragment) => fragment.x >= gutter.centre),
      options,
    );
    if (leftText.length > 0) leftBuffer.push(leftText);
    if (rightText.length > 0) rightBuffer.push(rightText);
  }
  flushColumns();

  return collapseBlankRuns(out.join("\n"));
}

/**
 * Known limitations of this strategy, kept next to the code so they stay honest:
 *
 *  - It handles at most one gutter, so a three-column page is read as two.
 *  - It has no notion of paragraphs, so wrapped lines are not rejoined.
 *  - Tables are treated as ordinary lines and lose their cell structure.
 *  - Rotated or vertical text is grouped by its baseline and will interleave.
 *  - Footnotes and headers are emitted in page position, not document order.
 */
