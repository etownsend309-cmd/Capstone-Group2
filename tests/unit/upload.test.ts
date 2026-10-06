import { describe, expect, it } from "vitest";

import { validatePdfFile } from "../../src/poc/components/PdfUpload";
import { formatBytes, formatCount, formatMs, formatPageList, statusLabel } from "../../src/poc/format";
import { MAX_UPLOAD_BYTES } from "../../src/pdf/evaluateExtraction";

function file(name: string, type: string, size: number): File {
  const blob = new Blob([new Uint8Array(Math.min(size, 1024))], { type });
  const handle = new File([blob], name, { type });
  // Constructing a genuinely huge File is wasteful; report the size instead.
  Object.defineProperty(handle, "size", { value: size });
  return handle;
}

describe("validatePdfFile", () => {
  it("requires a file", () => {
    const result = validatePdfFile(null);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Choose a PDF");
  });

  it("accepts a PDF by MIME type", () => {
    expect(validatePdfFile(file("agreement.pdf", "application/pdf", 2048)).ok).toBe(true);
  });

  it("accepts a PDF by extension when the browser reports no type", () => {
    expect(validatePdfFile(file("agreement.PDF", "", 2048)).ok).toBe(true);
  });

  it("rejects a non-PDF and names the file", () => {
    const result = validatePdfFile(file("notes.txt", "text/plain", 500));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("notes.txt");
    expect(result.message).toContain("only accepts .pdf");
  });

  it("rejects an empty file", () => {
    const result = validatePdfFile(file("empty.pdf", "application/pdf", 0));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("empty");
  });

  it("rejects a file over the documented size limit", () => {
    const result = validatePdfFile(file("huge.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("above the");
  });

  it("accepts a file exactly at the limit", () => {
    expect(validatePdfFile(file("edge.pdf", "application/pdf", MAX_UPLOAD_BYTES)).ok).toBe(true);
  });
});

describe("metric formatting", () => {
  it("formats byte sizes at each magnitude", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatBytes(-1)).toBe("unknown");
  });

  it("formats durations at each magnitude", () => {
    expect(formatMs(0.4)).toBe("<1 ms");
    expect(formatMs(42.6)).toBe("43 ms");
    expect(formatMs(1500)).toBe("1.50 s");
    expect(formatMs(Number.NaN)).toBe("n/a");
  });

  it("groups large counts", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("summarizes page lists without running on", () => {
    expect(formatPageList([])).toBe("none");
    expect(formatPageList([1, 2, 3])).toBe("1, 2, 3");
    expect(formatPageList([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toContain("+2 more");
  });

  it("labels every status", () => {
    expect(statusLabel("success")).toBe("Success");
    expect(statusLabel("warning")).toBe("Warning");
    expect(statusLabel("failed")).toBe("Failed");
  });
});
