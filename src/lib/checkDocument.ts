/**
 * Cheap checks run before an agreement is saved.
 *
 * Saving comes first so that a PDF with no readable text still gets a record
 * and the recovery path. That makes this the only place a plainly unusable
 * file (empty, wrong type, or not a PDF at all) is stopped before a record
 * exists. It does not parse the PDF: a scanned PDF passes here, is saved, and
 * is handled by text preparation.
 *
 * The rules mirror `detectContentType` on the server, so a file that passes
 * here is not refused when it is stored.
 */

const PDF_SIGNATURE = "%PDF-";

const isPdf = (file: File) =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const isTxt = (file: File) =>
  file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt");

/** Resolves when the file may be saved, or rejects with a message for the person. */
export async function checkDocument(file: File): Promise<void> {
  if (file.size === 0) throw new Error("That file is empty.");
  if (!isPdf(file) && !isTxt(file)) throw new Error("Please choose a PDF or plain-text file.");
  if (isPdf(file)) {
    const start = await file.slice(0, PDF_SIGNATURE.length).text();
    if (start !== PDF_SIGNATURE) throw new Error("That file isn't a valid PDF.");
  }
}
