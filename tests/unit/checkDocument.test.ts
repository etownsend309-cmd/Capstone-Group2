import { describe, expect, it } from "vitest";

import { checkDocument } from "../../src/lib/checkDocument";

const pdf = (content: string, name = "agreement.pdf") =>
  new File([content], name, { type: "application/pdf" });

// These cover the checks made before an agreement is saved. They do not parse
// a PDF, so a scanned or image-only file is allowed through on purpose and is
// handled by text preparation after it is saved.
describe("checkDocument", () => {
  it.each([
    ["empty.pdf", "application/pdf"],
    ["empty.txt", "text/plain"],
  ])("rejects empty %s", async (name, type) => {
    await expect(checkDocument(new File([], name, { type }))).rejects.toThrow("That file is empty.");
  });

  it.each([
    ["tool.exe", "application/octet-stream"],
    ["image.png", "image/png"],
    ["agreement.docx", ""],
    ["agreement", ""],
  ])("rejects unsupported %s", async (name, type) => {
    await expect(checkDocument(new File(["MZ"], name, { type }))).rejects.toThrow(
      "Please choose a PDF or plain-text file.",
    );
  });

  it.each(["plain text", "%PDX-1.7", " %PDF-1.7", "%PDF"])(
    'rejects a PDF whose bytes start with "%s"',
    async (content) => {
      await expect(checkDocument(pdf(content, "spoof.pdf"))).rejects.toThrow("That file isn't a valid PDF.");
    },
  );

  it("accepts a PDF with a valid signature, even if it has no readable text", async () => {
    await expect(checkDocument(pdf("%PDF-1.7\n"))).resolves.toBeUndefined();
  });

  it.each([
    ["notes.txt", "text/plain"],
    ["AGREEMENT.TXT", ""],
    ["download", "text/plain"],
  ])("accepts text file %s", async (name, type) => {
    await expect(checkDocument(new File(["Agreement text"], name, { type }))).resolves.toBeUndefined();
  });

  it("recognizes a PDF by extension when the browser gives no type", async () => {
    await expect(checkDocument(new File(["%PDF-1.7"], "AGREEMENT.PDF", { type: "" }))).resolves.toBeUndefined();
    await expect(checkDocument(new File(["not a pdf"], "AGREEMENT.PDF", { type: "" }))).rejects.toThrow(
      "That file isn't a valid PDF.",
    );
  });
});
