import { describe, expect, it } from "vitest";

import { buildContentOrderText } from "../../src/pdf/contentOrder";
import {
  detectColumnGutter,
  groupIntoLines,
  lineToText,
  reconstructCoordinateOrder,
} from "../../src/pdf/coordinateOrder";
import type { TextFragment } from "../../src/pdf/types";

/** Build a fragment with sensible defaults; PDF user space has y increasing upward. */
function frag(
  text: string,
  x: number,
  y: number,
  width = text.length * 5,
  options: Partial<TextFragment> = {},
): TextFragment {
  return { text, x, y, width, height: 10, hasEOL: false, ...options };
}

/**
 * A two-column page whose fragments are listed in visual row order, which is
 * the layout that defeats content-stream order.
 *
 * Left column x=50..250, gutter 250..320, right column x=320..520.
 */
function twoColumnRowInterleaved(): TextFragment[] {
  const fragments: TextFragment[] = [];
  const leftLines = ["left one", "left two", "left three", "left four", "left five"];
  const rightLines = ["right one", "right two", "right three", "right four", "right five"];
  for (let row = 0; row < leftLines.length; row += 1) {
    const y = 700 - row * 20;
    fragments.push(frag(leftLines[row], 50, y, 200));
    fragments.push(frag(rightLines[row], 320, y, 200));
  }
  return fragments;
}

describe("groupIntoLines", () => {
  it("groups fragments that share a baseline and orders lines top to bottom", () => {
    const lines = groupIntoLines([
      frag("second line", 50, 680),
      frag("first line", 50, 700),
      frag("also first", 200, 700),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].fragments.map((f) => f.text)).toEqual(["first line", "also first"]);
    expect(lines[1].fragments.map((f) => f.text)).toEqual(["second line"]);
  });

  it("sorts fragments within a line left to right regardless of input order", () => {
    const lines = groupIntoLines([frag("world", 200, 700), frag("hello", 50, 700)]);
    expect(lines[0].fragments.map((f) => f.text)).toEqual(["hello", "world"]);
  });

  it("tolerates small baseline jitter within one line", () => {
    const lines = groupIntoLines([frag("a", 50, 700), frag("b", 80, 697.5)]);
    expect(lines).toHaveLength(1);
  });

  it("separates lines that are clearly apart", () => {
    const lines = groupIntoLines([frag("a", 50, 700), frag("b", 50, 680)]);
    expect(lines).toHaveLength(2);
  });

  it("returns nothing for no fragments", () => {
    expect(groupIntoLines([])).toEqual([]);
  });
});

describe("lineToText", () => {
  it("inserts a space where the geometry shows a gap", () => {
    const [line] = groupIntoLines([frag("hello", 50, 700, 30), frag("world", 100, 700, 30)]);
    expect(lineToText(line)).toBe("hello world");
  });

  it("does not double up spaces that are already in the fragments", () => {
    const [line] = groupIntoLines([frag("hello ", 50, 700, 32), frag("world", 100, 700, 30)]);
    expect(lineToText(line)).toBe("hello world");
  });

  it("keeps adjacent fragments joined when there is no gap", () => {
    const [line] = groupIntoLines([frag("Agree", 50, 700, 25), frag("ment", 75, 700, 20)]);
    expect(lineToText(line)).toBe("Agreement");
  });
});

describe("detectColumnGutter", () => {
  it("finds the gutter on a two-column page", () => {
    const gutter = detectColumnGutter(twoColumnRowInterleaved());
    expect(gutter.found).toBe(true);
    expect(gutter.centre).toBeGreaterThan(250);
    expect(gutter.centre).toBeLessThan(320);
  });

  it("still finds the gutter when a full-width title crosses it", () => {
    const fragments = [
      frag("A CENTRED DOCUMENT TITLE ACROSS BOTH COLUMNS", 120, 740, 380),
      ...twoColumnRowInterleaved(),
    ];
    expect(detectColumnGutter(fragments).found).toBe(true);
  });

  // Regression: the first version of this required a gutter 3.5% of the text
  // width wide, which missed every real LaTeX two-column document. LaTeX's
  // default \columnsep of 10pt is about 2% of a 467pt text width, so Strategy B
  // silently fell back to single-column and interleaved the columns.
  it("finds a narrow LaTeX-width gutter", () => {
    const columnWidth = 228;
    const gutterWidth = 10;
    const rightStart = 72 + columnWidth + gutterWidth;
    const fragments = Array.from({ length: 20 }, (_, row) => [
      frag(`left column line ${row}`, 72, 700 - row * 14, columnWidth),
      frag(`right column line ${row}`, rightStart, 700 - row * 14, columnWidth),
    ]).flat();

    const gutter = detectColumnGutter(fragments);
    expect(gutter.found).toBe(true);
    expect(gutter.centre).toBeGreaterThan(72 + columnWidth);
    expect(gutter.centre).toBeLessThan(rightStart);
  });

  it("reports no gutter on a single-column page", () => {
    const fragments = Array.from({ length: 12 }, (_, row) =>
      frag(`single column line ${row}`, 50, 700 - row * 20, 460),
    );
    expect(detectColumnGutter(fragments).found).toBe(false);
  });

  it("does not mistake a paragraph indent for a column break", () => {
    const fragments = Array.from({ length: 12 }, (_, row) =>
      frag(`indented body line ${row}`, row === 0 ? 74 : 50, 700 - row * 20, 460),
    );
    expect(detectColumnGutter(fragments).found).toBe(false);
  });

  it("declines to guess with too few fragments", () => {
    expect(detectColumnGutter([frag("a", 50, 700), frag("b", 400, 700)]).found).toBe(false);
  });
});

describe("reconstructCoordinateOrder", () => {
  it("reads a two-column page column by column, not row by row", () => {
    const text = reconstructCoordinateOrder(twoColumnRowInterleaved());
    expect(text.split("\n")).toEqual([
      "left one",
      "left two",
      "left three",
      "left four",
      "left five",
      "right one",
      "right two",
      "right three",
      "right four",
      "right five",
    ]);
  });

  it("is a genuine improvement over content-stream order for this layout", () => {
    const fragments = twoColumnRowInterleaved();
    const streamOrder = buildContentOrderText(
      fragments.map((f, index) => ({ ...f, hasEOL: index % 2 === 1 })),
    );
    // Stream order interleaves the columns on every line.
    expect(streamOrder.split("\n")[0]).toBe("left oneright one");
    expect(reconstructCoordinateOrder(fragments).split("\n")[0]).toBe("left one");
  });

  it("emits a full-width heading before the columns it introduces", () => {
    const fragments = [
      frag("SECTION HEADING SPANNING THE PAGE", 120, 740, 380),
      ...twoColumnRowInterleaved(),
    ];
    const lines = reconstructCoordinateOrder(fragments).split("\n");
    expect(lines[0]).toBe("SECTION HEADING SPANNING THE PAGE");
    expect(lines[1]).toBe("left one");
  });

  it("flushes the columns when a full-width line interrupts them", () => {
    const fragments = [
      frag("left A", 50, 700, 200),
      frag("right A", 320, 700, 200),
      frag("left B", 50, 680, 200),
      frag("right B", 320, 680, 200),
      frag("A FULL WIDTH DIVIDER LINE HERE", 120, 660, 380),
      frag("left C", 50, 640, 200),
      frag("right C", 320, 640, 200),
      frag("left D", 50, 620, 200),
      frag("right D", 320, 620, 200),
    ];
    expect(reconstructCoordinateOrder(fragments).split("\n")).toEqual([
      "left A",
      "left B",
      "right A",
      "right B",
      "A FULL WIDTH DIVIDER LINE HERE",
      "left C",
      "left D",
      "right C",
      "right D",
    ]);
  });

  it("leaves a single-column page in top-to-bottom order", () => {
    const fragments = Array.from({ length: 10 }, (_, row) =>
      frag(`line ${row}`, 50, 700 - row * 20, 460),
    );
    expect(reconstructCoordinateOrder(fragments).split("\n")).toEqual(
      Array.from({ length: 10 }, (_, row) => `line ${row}`),
    );
  });

  it("returns an empty string when there are no fragments", () => {
    expect(reconstructCoordinateOrder([])).toBe("");
  });
});

describe("buildContentOrderText", () => {
  it("breaks lines only where PDF.js marks an end of line", () => {
    const text = buildContentOrderText([
      frag("Hello ", 0, 0),
      frag("world", 0, 0, 25, { hasEOL: true }),
      frag("Second line", 0, 0),
    ]);
    expect(text).toBe("Hello world\nSecond line");
  });

  it("collapses runs of blank lines", () => {
    const text = buildContentOrderText([
      frag("a", 0, 0, 5, { hasEOL: true }),
      frag("", 0, 0, 0, { hasEOL: true }),
      frag("", 0, 0, 0, { hasEOL: true }),
      frag("", 0, 0, 0, { hasEOL: true }),
      frag("b", 0, 0),
    ]);
    expect(text).toBe("a\n\nb");
  });
});
