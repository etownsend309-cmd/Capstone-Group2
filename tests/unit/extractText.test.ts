/**
 * Tests for the review workflow's extraction adapter.
 *
 * These run the real PDF.js parse against the generated fixtures, so they
 * verify the adapter against the same documents the benchmark reports on.
 * Never point a test at fixtures/private.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extractText } from "../../src/lib/extractText";
import { MAX_UPLOAD_BYTES } from "../../src/pdf/evaluateExtraction";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/generated",
);

async function pdfFixture(name: string): Promise<File> {
  const bytes = await readFile(path.join(FIXTURES, name));
  return new File([bytes], name, { type: "application/pdf" });
}

const txtFile = (text: string, name = "agreement.txt") =>
  new File([text], name, { type: "text/plain" });

describe("extractText", () => {
  describe("plain text", () => {
    it("reads a TXT file without involving PDF.js", async () => {
      const result = await extractText(txtFile("GOVERNING LAW. Governed by the laws of Georgia."));

      expect(result.text).toContain("GOVERNING LAW");
      // Plain text has no pages, so the review record must not invent one.
      expect(result.pageCount).toBeUndefined();
      expect(result.strategy).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });

    it("rejects a TXT file that is only whitespace", async () => {
      await expect(extractText(txtFile("   \n\t  "))).rejects.toThrow(/no readable text/i);
    });
  });

  describe("input validation", () => {
    it("rejects an empty file", async () => {
      await expect(extractText(txtFile(""))).rejects.toThrow(/empty/i);
    });

    it("rejects a file that is neither PDF nor plain text", async () => {
      const file = new File(["binary"], "logo.png", { type: "image/png" });
      await expect(extractText(file)).rejects.toThrow(/PDF or plain-text/i);
    });

    it("rejects a file over the documented size limit", async () => {
      const file = txtFile("small body");
      Object.defineProperty(file, "size", { value: MAX_UPLOAD_BYTES + 1 });

      await expect(extractText(file)).rejects.toThrow(/larger than the 25 MB limit/i);
    });
  });

  describe("PDF extraction", () => {
    it("extracts a clean agreement and preserves its page count", async () => {
      const result = await extractText(await pdfFixture("clean-agreement.pdf"));

      expect(result.pageCount).toBe(2);
      expect(result.text.length).toBeGreaterThan(1_000);
      expect(result.strategy).toBe("coordinate-order");
    });

    it("reads a two-column agreement in visual reading order", async () => {
      const result = await extractText(await pdfFixture("multicolumn-agreement.pdf"));

      // Strategy B is preferred precisely because stream order interleaves the
      // columns here; the left column must finish before the right one starts.
      expect(result.strategy).toBe("coordinate-order");
      expect(result.text.length).toBeGreaterThan(500);
    });

    it("explains a scanned PDF instead of returning empty text", async () => {
      await expect(extractText(await pdfFixture("scanned-agreement.pdf"))).rejects.toThrow(
        /scanned|image-only|OCR/i,
      );
    });

    it("explains an unparseable PDF rather than throwing a raw PDF.js error", async () => {
      await expect(extractText(await pdfFixture("corrupt-agreement.pdf"))).rejects.toThrow(
        /^(?!.*\bat\s).*$/s,
      );
    });
  });
});
