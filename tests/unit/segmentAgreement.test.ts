import { describe, expect, it } from "vitest";
import { SEGMENT_CHAR_LIMIT, segmentAgreement } from "../../src/lib/segmentAgreement";

const id = "b0000000-0000-4000-8000-000000000001";

describe("agreement segmentation", () => {
  it("retains exact offsets, order, version and repeated clauses", () => {
    const text = "  1. Governing Law\nGeorgia law applies.\n\n2. Audit Rights\nAudit rights apply.\n\nAudit rights apply.  ";
    const result = segmentAgreement(id, 3, text);
    expect(result.length).toBeGreaterThan(2);
    expect(result.map((s) => s.sequence)).toEqual(result.map((_, i) => i + 1));
    for (const segment of result) {
      expect(segment).toMatchObject({ agreementId: id, version: 3, pageStart: null, pageEnd: null });
      expect(text.slice(segment.startOffset, segment.endOffset)).toBe(segment.text);
    }
    expect(result.map((s) => s.text).join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
    expect(segmentAgreement(id, 3, text)).toEqual(result);
    expect(segmentAgreement(id, 4, text)[0]!.id).not.toBe(result[0]!.id);
  });

  it("splits pages without inventing a page for supplied text", () => {
    const text = "Page one\n\nPage two";
    const result = segmentAgreement(id, 1, text, [
      { pageNumber: 1, startOffset: 0, endOffset: 8 }, { pageNumber: 2, startOffset: 10, endOffset: 18 },
    ]);
    expect(result.map((s) => [s.pageStart, s.pageEnd])).toEqual([[1, 1], [2, 2]]);
    expect(segmentAgreement(id, 1, text).every((s) => s.pageStart === null)).toBe(true);
  });

  it("bounds long paragraphs without splitting a surrogate pair or dropping text", () => {
    const text = "a".repeat(1799) + "😀" + "b".repeat(4000);
    const result = segmentAgreement(id, 1, text);
    expect(result.every((s) => s.text.length <= SEGMENT_CHAR_LIMIT)).toBe(true);
    expect(result.map((s) => s.text).join("")).toBe(text);
    expect(result.some((s) => /[\ud800-\udbff]$/.test(s.text))).toBe(false);
  });

  it.each(["", " \n\t "])("refuses unreadable text %j", (text) => {
    expect(() => segmentAgreement(id, 1, text)).toThrow(/readable text/);
  });

  it("rejects overlapping, out-of-range and incomplete page locations", () => {
    for (const pages of [
      [{ pageNumber: 1, startOffset: 2, endOffset: 5 }],
      [{ pageNumber: 1, startOffset: 0, endOffset: 4 }],
      [{ pageNumber: 2, startOffset: 0, endOffset: 5 }],
      [{ pageNumber: 1, startOffset: 0, endOffset: 6 }],
      [{ pageNumber: 1, startOffset: 0, endOffset: 4 }, { pageNumber: 2, startOffset: 3, endOffset: 5 }],
    ]) expect(() => segmentAgreement(id, 1, "abcde", pages)).toThrow(/Page locations/);
  });

  it("handles CRLF, Unicode and empty PDF pages with stable source locations", () => {
    const text = "\n\n1. Café\r\nFirst clause.\r\n\r\n2. 保険\r\nSecond clause.";
    const segments = segmentAgreement(id, 1, text, [
      { pageNumber: 1, startOffset: 0, endOffset: 0 },
      { pageNumber: 2, startOffset: 2, endOffset: text.length },
    ]);
    expect(segments.every((s) => s.pageStart === 2)).toBe(true);
    expect(segments.map((s) => s.text).join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  });
});
