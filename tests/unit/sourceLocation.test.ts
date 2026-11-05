import { describe, expect, it } from "vitest";
import { locateSource } from "../../src/lib/sourceLocation";
import type { IngestionRecord } from "../../src/shared/ingestion";

const text = "😀 Georgia law. Georgia law.";
const record: IngestionRecord = { agreementId: "agreement", version: 1, state: "ready", error: null, segmentCount: 1,
  source: "extracted", text, pageCount: 2, strategy: null, warnings: [],
  pages: [{ pageNumber: 1, startOffset: 0, endOffset: 16 }, { pageNumber: 2, startOffset: 16, endOffset: text.length }],
  segments: [{ id: "one", agreementId: "agreement", version: 1, sequence: 1, text, startOffset: 0, endOffset: text.length, pageStart: 1, pageEnd: 2 }] };

describe("source navigation", () => {
  it("locates repeated exact citations using UTF-16 positions", () => {
    expect(locateSource(text, "Georgia law.").map((item) => item.startOffset)).toEqual([3, 16]);
  });
  it("reports verified pages and intersecting sections", () => {
    expect(locateSource(text, "Georgia law.", record)).toEqual([
      { startOffset: 3, endOffset: 15, pageStart: 1, pageEnd: 1, sections: [1] },
      { startOffset: 16, endOffset: 28, pageStart: 2, pageEnd: 2, sections: [1] },
    ]);
    expect(locateSource(text, "law. Georgia", record)[0]).toMatchObject({ pageStart: 1, pageEnd: 2 });
  });
  it("does not guess locations for normalized or missing citations", () => {
    expect(locateSource(text, "Georgia  law.")).toEqual([]);
    expect(locateSource(text, "")).toEqual([]);
    expect(locateSource(text, "Georgia…")).toEqual([]);
  });
  it("does not reuse stale source metadata", () => {
    expect(locateSource(text, "Georgia law.", { ...record, text: "different" })[0]).toMatchObject({ pageStart: null, sections: [] });
  });
  it("rejects invalid page bounds and section evidence", () => {
    const malformed = { ...record, pages: [{ pageNumber: 99, startOffset: 0, endOffset: text.length }], segments: [{ ...record.segments[0]!, text: "invented" }] };
    expect(locateSource(text, "Georgia law.", malformed)[0]).toMatchObject({ pageStart: null, sections: [] });
  });
  it("does not fabricate page numbers for supplied text", () => {
    expect(locateSource(text, "Georgia law.", { ...record, source: "supplied", pages: [], pageCount: null })[0]?.pageStart).toBeNull();
  });
});
