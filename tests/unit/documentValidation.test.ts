import { describe, expect, it } from "vitest";

import { detectContentType, type UploadedFile } from "../../server/services/documents";
import { ApiError } from "../../server/errors";
import { LIMITS } from "../../src/shared/api";
import { MAX_UPLOAD_BYTES } from "../../src/pdf/evaluateExtraction";

// This tests the storage validator, not PDF parsing or a real storage service.
const pdfHeader = new TextEncoder().encode("%PDF-1.7\n");
const file = (name: string, type: string, data: ArrayBuffer = pdfHeader.slice().buffer): UploadedFile => ({ name, type, data });
function expectInvalid(input: UploadedFile, message: string) {
  let error: unknown;
  try { detectContentType(input); } catch (reason) { error = reason; }
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 400, message });
}

describe("document storage validation", () => {
  it.each([["empty.pdf", "application/pdf"], ["empty.txt", "text/plain"]])("rejects empty %s", (name, type) => {
    expectInvalid(file(name, type, new ArrayBuffer(0)), "The file is empty.");
  });

  it.each([["tool.exe", "application/octet-stream"], ["image.png", "image/png"], ["agreement.docx", ""], ["agreement", ""]])("rejects unsupported %s without a supported MIME type", (name, type) => {
    expectInvalid(file(name, type), "Only PDF and TXT files can be uploaded.");
  });

  it.each([["AGREEMENT.PDF", ""], ["agreement.pdf", "application/octet-stream"], ["download", "application/pdf"]])("recognizes PDF by extension or MIME as currently supported: %s", (name, type) => {
    expect(detectContentType(file(name, type))).toBe("application/pdf");
  });

  it.each([0, 1, 2, 3, 4])("rejects a truncated PDF signature of %i bytes", (length) => {
    const data = pdfHeader.slice(0, length).buffer;
    expectInvalid(file("spoof.pdf", "application/pdf", data), length === 0 ? "The file is empty." : "That file isn't a valid PDF.");
  });

  it.each(["plain text", "%PDX-1.7", " %PDF-1.7"])('rejects a renamed/spoofed PDF with bytes "%s"', (text) => {
    expectInvalid(file("spoof.pdf", "application/pdf", new TextEncoder().encode(text).buffer), "That file isn't a valid PDF.");
  });

  it.each([LIMITS.documentBytes - 1, LIMITS.documentBytes])("accepts a PDF signature at the existing %i-byte boundary", (size) => {
    const data = new ArrayBuffer(size);
    new Uint8Array(data).set(pdfHeader);
    expect(detectContentType(file("boundary.pdf", "application/pdf", data))).toBe("application/pdf");
  });

  it("rejects one byte over the existing maximum", () => {
    expectInvalid(file("large.pdf", "application/pdf", new ArrayBuffer(LIMITS.documentBytes + 1)), "Files must be 25 MB or smaller.");
  });

  it.each([["AGREEMENT.TXT", ""], ["download", "text/plain"]])("preserves UTF-8 TXT support: %s", (name, type) => {
    expect(detectContentType(file(name, type, new TextEncoder().encode("Agreement \u2014 caf\u00e9").buffer))).toBe("text/plain");
  });

  it("rejects invalid UTF-8 in TXT", () => {
    expectInvalid(file("bad.txt", "text/plain", new Uint8Array([0xc3, 0x28]).buffer), "Text files must be UTF-8.");
  });

  it("keeps browser extraction and storage limits aligned", () => {
    expect(MAX_UPLOAD_BYTES).toBe(LIMITS.documentBytes);
  });
});
