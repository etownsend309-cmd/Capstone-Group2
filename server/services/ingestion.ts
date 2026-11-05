import { createHash } from "node:crypto";
import type { Queryable } from "../db.ts";
import { isUuid } from "../db.ts";
import { badRequest, conflict, forbidden, notFound } from "../errors.ts";
import { LIMITS } from "../../src/shared/api.ts";
import type { IngestionInput, IngestionRecord, SourcePage } from "../../src/shared/ingestion.ts";
import { segmentAgreement } from "../../src/lib/segmentAgreement.ts";
import { recordAudit } from "./audit.ts";

interface IngestionRow {
  agreement_id: string;
  version: number;
  state: IngestionRecord["state"];
  source: IngestionRecord["source"];
  source_text: string;
  pages: SourcePage[];
  segments: IngestionRecord["segments"];
  page_count: number | null;
  strategy: string | null;
  warnings: string[];
  source_hash: string | null;
  error: string | null;
}

function toRecord(row: IngestionRow): IngestionRecord {
  return {
    agreementId: row.agreement_id, version: row.version, state: row.state, error: row.error,
    source: row.source, text: row.source_text, pages: row.pages, segments: row.segments,
    segmentCount: row.segments.length, pageCount: row.page_count, strategy: row.strategy, warnings: row.warnings,
  };
}

export async function getIngestion(db: Queryable, id: string): Promise<IngestionRecord> {
  if (!isUuid(id)) throw notFound("That agreement");
  const { rows } = await db.query<IngestionRow>("SELECT * FROM agreement_ingestions WHERE agreement_id = $1 ORDER BY version DESC LIMIT 1", [id]);
  if (!rows[0]) throw notFound("That ingestion");
  return toRecord(rows[0]);
}

export function parseIngestion(body: unknown): IngestionInput {
  if (!body || typeof body !== "object") throw badRequest("Send the ingestion details as JSON.");
  const input = body as Record<string, unknown>;
  if (!Number.isSafeInteger(input.version) || (input.version as number) < 1) throw badRequest("A positive agreement version is required.");
  if (input.failed !== undefined && typeof input.failed !== "boolean") throw badRequest("Invalid failure status.");
  if (input.failed === true) return { version: input.version as number, failed: true };
  if (typeof input.text !== "string" || input.text.length > LIMITS.rawTextChars) throw badRequest("Supply agreement text within the two-million-character limit.");
  if (input.source !== "extracted" && input.source !== "supplied") throw badRequest("Choose extracted or supplied text.");
  if (input.pageCount !== undefined && (!Number.isSafeInteger(input.pageCount) || (input.pageCount as number) < 1)) throw badRequest("Invalid page count.");
  if (input.strategy !== undefined && (typeof input.strategy !== "string" || input.strategy.length > 200)) throw badRequest("Invalid extraction strategy.");
  if (input.warnings !== undefined && (!Array.isArray(input.warnings) || input.warnings.length > 20 || input.warnings.some((w) => typeof w !== "string" || w.length > 500))) throw badRequest("Invalid extraction warnings.");
  const pages = input.pages ?? [];
  if (!Array.isArray(pages) || pages.length > 20000 || pages.some((p) => !p || typeof p !== "object"
    || !Number.isSafeInteger(p.pageNumber) || !Number.isSafeInteger(p.startOffset) || !Number.isSafeInteger(p.endOffset))) throw badRequest("Invalid page locations.");
  if (pages.length && input.pageCount !== pages.length) throw badRequest("Page count must match the supplied page locations.");
  if (input.source === "supplied" && (pages.length || input.pageCount !== undefined)) throw badRequest("Supplied text has no verified PDF page locations.");
  return {
    version: input.version as number, text: input.text, source: input.source, pages: pages as SourcePage[],
    pageCount: input.pageCount as number | undefined, strategy: input.strategy as string | undefined, warnings: input.warnings as string[] | undefined,
  };
}

export async function processIngestion(db: Queryable, userId: string, id: string, input: IngestionInput): Promise<IngestionRecord> {
  if (!isUuid(id)) throw notFound("That agreement");
  const { rows } = await db.query<IngestionRow>("SELECT * FROM agreement_ingestions WHERE agreement_id = $1 AND version = $2 FOR UPDATE", [id, input.version]);
  const row = rows[0];
  if (!row) {
    const visible = await db.query("SELECT 1 FROM agreement_ingestions WHERE agreement_id = $1", [id]);
    if (visible.rowCount) throw forbidden("You cannot process this agreement version.");
    throw notFound("That ingestion");
  }
  const agreement = await db.query<{ status: string }>("SELECT status FROM agreements WHERE id = $1", [id]);
  if (!agreement.rows[0]) throw notFound("That agreement");
  const text = input.text ?? "";
  const pages = (input.pages ?? []).map(({ pageNumber, startOffset, endOffset }) => ({ pageNumber, startOffset, endOffset }));
  const hash = createHash("sha256").update(JSON.stringify([text, pages, input.source, input.pageCount ?? null, input.strategy ?? null])).digest("hex");
  if (row.state === "ready") {
    if (!input.failed && row.source_hash === hash) return toRecord(row);
    throw conflict("This version already has ready source text. Submit a new agreement version to change it.");
  }
  if (agreement.rows[0].status !== "needs_review") throw conflict("Review has started. Source text cannot be replaced.");

  let segments: IngestionRecord["segments"] = [];
  let error: string | null = null;
  try {
    if (input.failed) throw new Error("Extraction failed. Retry with a readable PDF or supply the agreement text.");
    segments = segmentAgreement(id, input.version, text, pages);
  } catch {
    error = "Text could not be prepared. Retry with a readable PDF or supply the agreement text.";
  }
  const updated = await db.query<IngestionRow>(
    `UPDATE agreement_ingestions SET state = $3, source = $4, source_text = $5,
      pages = $6::jsonb, segments = $7::jsonb, page_count = $8, strategy = $9,
      warnings = $10, source_hash = $11, error = $12, updated_at = now()
     WHERE agreement_id = $1 AND version = $2 RETURNING *`,
    [id, input.version, error ? "failed" : "ready", input.source ?? "extracted", error ? "" : text,
      JSON.stringify(error ? [] : pages), JSON.stringify(segments), input.pageCount ?? null,
      input.strategy ?? null, input.warnings ?? [], error ? null : hash, error],
  );
  await recordAudit(db, userId, id, error ? "ingestion.failed" : "ingestion.ready", { version: input.version, source: input.source ?? "extracted", segmentCount: segments.length });
  return toRecord(updated.rows[0]!);
}
