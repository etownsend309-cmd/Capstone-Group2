/**
 * Generate the safe, synthetic PDF fixtures used by the POC.
 *
 *   npm run fixtures
 *
 * Everything here runs in Node with pure JavaScript libraries: `pdf-lib` writes
 * the PDFs and `jimp` rasterises the scanned page. No browser and no Python.
 *
 * Writes into fixtures/generated/:
 *   clean-agreement.pdf        + clean-agreement.expected.txt
 *   multicolumn-agreement.pdf  + multicolumn-agreement.expected.txt
 *   scanned-agreement.pdf      + scanned-agreement.expected.txt
 *   corrupt-agreement.pdf      (deliberately invalid, no ground truth)
 *   fixtures.json              (manifest read by the benchmark and the tests)
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Jimp, loadFont } from "jimp";
import { SANS_32_BLACK } from "jimp/fonts";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import {
  CLEAN_SECTIONS,
  CLEAN_TITLE,
  MULTICOLUMN_BLOCKS,
  MULTICOLUMN_TITLE,
  SCANNED_LINES,
  type Section,
} from "./fixtureContent.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(REPO_ROOT, "fixtures", "generated");

/**
 * Fixed document timestamp.
 *
 * pdf-lib stamps `CreationDate` and `ModificationDate` with the current time,
 * which makes every regenerated fixture differ from the committed one even when
 * the content is byte-for-byte the same otherwise. Pinning them keeps
 * `npm run fixtures` reproducible, so regenerating produces identical files and
 * the committed benchmark keeps describing the documents everyone else has.
 */
const FIXTURE_DATE = new Date("2026-01-01T00:00:00.000Z");

const PAGE_WIDTH = 612; // US Letter, 72 dpi
const PAGE_HEIGHT = 792;
const MARGIN = 64;
const BODY_SIZE = 10.5;
const HEADING_SIZE = 11.5;
const TITLE_SIZE = 15;
const LEADING = 14.5;

export interface FixtureManifestEntry {
  id: string;
  file: string;
  category: "clean" | "difficult" | "scanned" | "unknown";
  expectedText: string | null;
  description: string;
  /**
   * What the POC should do with this file. Drives the benchmark's expectations.
   * "unspecified" is for PDFs found without a manifest, where there is nothing
   * to assert.
   */
  expectation: "extractable" | "no-text-layer" | "unparseable" | "unspecified";
}

/** A new PDF carrying the pinned metadata, so output is reproducible. */
async function createDocument(title: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("Capstone Group 2 fixture generator");
  doc.setCreationDate(FIXTURE_DATE);
  doc.setModificationDate(FIXTURE_DATE);
  return doc;
}

/** Greedy word wrap using the real font metrics so ground truth matches the PDF. */
function wrap(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// --------------------------------------------------------------------------
// 1. Clean single-column agreement
// --------------------------------------------------------------------------
async function buildClean(): Promise<{ bytes: Uint8Array; expected: string }> {
  const doc = await createDocument("Synthetic Master Services Agreement");

  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const textWidth = PAGE_WIDTH - 2 * MARGIN;

  const pagesOfLines: string[][] = [];
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let pageLines: string[] = [];
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    pagesOfLines.push(pageLines);
    pageLines = [];
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  const emit = (line: string, font: typeof body, size: number) => {
    if (y < MARGIN + LEADING) newPage();
    page.drawText(line, { x: MARGIN, y, size, font, color: rgb(0.06, 0.06, 0.06) });
    pageLines.push(line);
    y -= LEADING;
  };

  emit(CLEAN_TITLE, bold, TITLE_SIZE);
  y -= LEADING * 0.5;

  for (const section of CLEAN_SECTIONS) {
    if (y < MARGIN + LEADING * 4) newPage();
    y -= LEADING * 0.4;
    emit(section.heading, bold, HEADING_SIZE);
    for (const paragraph of section.paragraphs) {
      for (const line of wrap(paragraph, body, BODY_SIZE, textWidth)) {
        emit(line, body, BODY_SIZE);
      }
      y -= LEADING * 0.35;
    }
  }
  pagesOfLines.push(pageLines);

  return {
    bytes: await doc.save(),
    expected: pagesOfLines
      .filter((lines) => lines.length > 0)
      .map((lines) => lines.join("\n"))
      .join("\n\n"),
  };
}

// --------------------------------------------------------------------------
// 2. Multi-column agreement - the difficult reading-order case
// --------------------------------------------------------------------------
/**
 * Two columns, drawn in *visual row order*: left line 1, right line 1, left
 * line 2, right line 2, and so on.
 *
 * This is the point of the fixture. Some producers write a two-column page
 * column-by-column, in which case content-stream order is already correct.
 * Others write it row-by-row, which interleaves the columns for anything that
 * trusts stream order. This fixture deliberately represents the second case so
 * the two strategies can be told apart. See docs/pdf-extraction-poc.md.
 */
async function buildMultiColumn(): Promise<{ bytes: Uint8Array; expected: string }> {
  const doc = await createDocument("Synthetic Supplemental Terms (two column)");

  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const gutter = 26;
  const columnWidth = (PAGE_WIDTH - 2 * MARGIN - gutter) / 2;
  const columnX = [MARGIN, MARGIN + columnWidth + gutter];

  /** Render one block into a flat list of drawable lines. */
  const blockLines = (block: Section): Array<{ text: string; bold: boolean }> => {
    const lines: Array<{ text: string; bold: boolean }> = [
      { text: block.heading, bold: true },
      { text: "", bold: false },
    ];
    for (const paragraph of block.paragraphs) {
      for (const line of wrap(paragraph, body, BODY_SIZE, columnWidth)) {
        lines.push({ text: line, bold: false });
      }
      lines.push({ text: "", bold: false });
    }
    return lines;
  };

  const pageBlocks = [MULTICOLUMN_BLOCKS.slice(0, 2), MULTICOLUMN_BLOCKS.slice(2, 4)];
  const expectedPages: string[] = [];

  for (const [pageIndex, blocks] of pageBlocks.entries()) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let top = PAGE_HEIGHT - MARGIN;
    const expectedLines: string[] = [];

    if (pageIndex === 0) {
      // Centre the title so it physically crosses the gutter, which is how the
      // coordinate strategy recognises a full-width heading.
      const titleWidth = bold.widthOfTextAtSize(MULTICOLUMN_TITLE, TITLE_SIZE);
      page.drawText(MULTICOLUMN_TITLE, {
        x: (PAGE_WIDTH - titleWidth) / 2,
        y: top,
        size: TITLE_SIZE,
        font: bold,
        color: rgb(0.06, 0.06, 0.06),
      });
      expectedLines.push(MULTICOLUMN_TITLE);
      top -= LEADING * 2;
    }

    const columns = blocks.map(blockLines);

    // Draw row by row across both columns: this is what interleaves the stream.
    const tallest = Math.max(...columns.map((lines) => lines.length));
    for (let row = 0; row < tallest; row += 1) {
      for (const [columnIndex, lines] of columns.entries()) {
        const line = lines[row];
        if (!line || line.text === "") continue;
        page.drawText(line.text, {
          x: columnX[columnIndex],
          y: top - row * LEADING,
          size: line.bold ? HEADING_SIZE : BODY_SIZE,
          font: line.bold ? bold : body,
          color: rgb(0.06, 0.06, 0.06),
        });
      }
    }

    // Ground truth is correct human reading order: whole left column, then right.
    for (const lines of columns) {
      for (const line of lines) {
        if (line.text !== "") expectedLines.push(line.text);
      }
    }
    expectedPages.push(expectedLines.join("\n"));
  }

  return { bytes: await doc.save(), expected: expectedPages.join("\n\n") };
}

// --------------------------------------------------------------------------
// 3. Scanned / image-only agreement
// --------------------------------------------------------------------------
/**
 * Rasterise known text to a grayscale image and embed it as the only content on
 * the page, so the PDF has no text layer at all. Expected content is known
 * because we rendered it ourselves.
 */
async function buildScanned(): Promise<{ bytes: Uint8Array; expected: string }> {
  const dpi = 150;
  const widthPx = Math.round(8.5 * dpi);
  const heightPx = Math.round(11 * dpi);

  const image = new Jimp({ width: widthPx, height: heightPx, color: 0xffffffff });
  const font = await loadFont(SANS_32_BLACK);

  let y = Math.round(dpi * 0.9);
  for (const line of SCANNED_LINES) {
    if (line) image.print({ font, x: Math.round(dpi * 0.8), y, text: line });
    y += 46;
  }

  // A light border sells the "scan" without affecting the point of the fixture.
  image.scan(0, 0, widthPx, heightPx, (px, py, index) => {
    const onBorder = px < 6 || py < 6 || px >= widthPx - 6 || py >= heightPx - 6;
    if (onBorder) {
      image.bitmap.data[index] = 210;
      image.bitmap.data[index + 1] = 210;
      image.bitmap.data[index + 2] = 210;
    }
  });
  image.greyscale();

  const jpeg = await image.getBuffer("image/jpeg", { quality: 72 });

  const doc = await createDocument("Synthetic Scanned Addendum");
  const embedded = await doc.embedJpg(jpeg);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawImage(embedded, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });

  return {
    bytes: await doc.save(),
    expected: SCANNED_LINES.filter((line) => line.trim().length > 0).join("\n"),
  };
}

// --------------------------------------------------------------------------
// 4. Corrupt / invalid PDF
// --------------------------------------------------------------------------
/** Claims to be a PDF, but the object body and cross-reference table are ruined. */
function buildCorrupt(): Uint8Array {
  const head = Buffer.from(
    "%PDF-1.7\n" +
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R\n",
    "latin1",
  );
  const garbage = Buffer.alloc(256 * 6);
  for (let index = 0; index < garbage.length; index += 1) garbage[index] = index % 256;
  const tail = Buffer.from("\ntrailer\n<< /Root 1 0 R >>\nstartxref\n999999\n%%EOF\n", "latin1");
  return new Uint8Array(Buffer.concat([head, garbage, tail]));
}

// --------------------------------------------------------------------------
async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest: FixtureManifestEntry[] = [];

  const write = async (name: string, bytes: Uint8Array) => {
    await writeFile(path.join(OUT_DIR, name), bytes);
    return bytes.byteLength;
  };

  const clean = await buildClean();
  await write("clean-agreement.pdf", clean.bytes);
  await writeFile(path.join(OUT_DIR, "clean-agreement.expected.txt"), `${clean.expected}\n`, "utf8");
  manifest.push({
    id: "clean",
    file: "clean-agreement.pdf",
    category: "clean",
    expectedText: "clean-agreement.expected.txt",
    description:
      "Single-column synthetic master services agreement with a normal machine-generated text layer.",
    expectation: "extractable",
  });

  const multi = await buildMultiColumn();
  await write("multicolumn-agreement.pdf", multi.bytes);
  await writeFile(
    path.join(OUT_DIR, "multicolumn-agreement.expected.txt"),
    `${multi.expected}\n`,
    "utf8",
  );
  manifest.push({
    id: "multicolumn",
    file: "multicolumn-agreement.pdf",
    category: "difficult",
    expectedText: "multicolumn-agreement.expected.txt",
    description:
      "Two-column supplemental terms whose content stream is written in visual row order, so stream order interleaves the columns. Ground truth is correct column-by-column reading order.",
    expectation: "extractable",
  });

  const scanned = await buildScanned();
  await write("scanned-agreement.pdf", scanned.bytes);
  await writeFile(
    path.join(OUT_DIR, "scanned-agreement.expected.txt"),
    `${scanned.expected}\n`,
    "utf8",
  );
  manifest.push({
    id: "scanned",
    file: "scanned-agreement.pdf",
    category: "scanned",
    expectedText: "scanned-agreement.expected.txt",
    description:
      "Image-only addendum rendered from known synthetic text. Has no text layer by design, so PDF.js must report it as unusable.",
    expectation: "no-text-layer",
  });

  await write("corrupt-agreement.pdf", buildCorrupt());
  manifest.push({
    id: "corrupt",
    file: "corrupt-agreement.pdf",
    category: "unknown",
    expectedText: null,
    description: "Damaged PDF body and cross-reference table, used to verify visible failure handling.",
    expectation: "unparseable",
  });

  await writeFile(
    path.join(OUT_DIR, "fixtures.json"),
    `${JSON.stringify({ fixtures: manifest }, null, 2)}\n`,
    "utf8",
  );

  const { statSync } = await import("node:fs");
  for (const entry of manifest) {
    const size = statSync(path.join(OUT_DIR, entry.file)).size;
    console.log(`  ${entry.file.padEnd(30)} ${size.toLocaleString().padStart(9)} bytes`);
  }
  console.log(`\nWrote ${manifest.length} fixtures and a manifest to ${path.relative(REPO_ROOT, OUT_DIR)}`);
}

main().catch((error) => {
  console.error("Fixture generation failed:", error);
  process.exitCode = 1;
});
