import { api } from "./api";
import { extractText } from "./extractText";
import type { IngestionRecord } from "../shared/ingestion";

export async function ingestDocument(id: string, version: number, file: File, canContinue: () => boolean = () => true): Promise<IngestionRecord> {
  let document: Awaited<ReturnType<typeof extractText>>;
  try {
    document = await extractText(file);
  } catch {
    if (!canContinue()) throw new Error("Text preparation paused after sign-out.");
    return api.processIngestion(id, { version, failed: true });
  }
  if (!canContinue()) throw new Error("Text preparation paused after sign-out.");
  return api.processIngestion(id, {
    version, text: document.text, source: "extracted", pages: document.pages,
    pageCount: document.pageCount, strategy: document.strategy,
    warnings: document.warnings.slice(0, 20).map((warning) => warning.slice(0, 500)),
  });
}
