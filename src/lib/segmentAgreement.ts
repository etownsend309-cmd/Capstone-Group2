import type { AgreementSegment, SourcePage } from "../shared/ingestion";

export const SEGMENT_CHAR_LIMIT = 1800;

export function segmentAgreement(
  agreementId: string,
  version: number,
  text: string,
  pages: SourcePage[] = [],
): AgreementSegment[] {
  if (!agreementId || !Number.isSafeInteger(version) || version < 1) throw new Error("Invalid agreement version.");
  if (!text.trim()) throw new Error("No readable text is available. Supply text or retry extraction.");
  let previousEnd = 0;
  pages.forEach((page, index) => {
    if (page.pageNumber !== index + 1 || !Number.isSafeInteger(page.startOffset) || !Number.isSafeInteger(page.endOffset)
      || page.startOffset < previousEnd || page.endOffset < page.startOffset || page.endOffset > text.length
      || text.slice(previousEnd, page.startOffset).trim()) throw new Error("Page locations do not match the source text.");
    previousEnd = page.endOffset;
  });
  if (pages.length && text.slice(previousEnd).trim()) throw new Error("Page locations do not cover the source text.");

  const segments: AgreementSegment[] = [];
  const boundaries = new Set([0, text.length]);
  for (const match of text.matchAll(/\n\s*\n|\n(?=\s*(?:(?:\d+(?:\.\d+)*[.)]?|[IVX]+\.)\s+|[A-Z][A-Z &/-]{3,}:?\s*(?:\n|$)))/g)) {
    boundaries.add(match.index + (match[0].startsWith("\n") ? 1 : 0));
  }
  for (const page of pages) { boundaries.add(page.startOffset); boundaries.add(page.endOffset); }
  const points = [...boundaries].sort((a, b) => a - b);
  for (let index = 0; index < points.length - 1; index++) {
    let start = points[index]!;
    const end = points[index + 1]!;
    while (start < end) {
      while (start < end && /\s/.test(text[start]!)) start++;
      if (start >= end) break;
      let stop = Math.min(start + SEGMENT_CHAR_LIMIT, end);
      if (stop < end) {
        const nearby = text.slice(start, stop);
        const breakAt = Math.max(nearby.lastIndexOf(" "), nearby.lastIndexOf("\n"), nearby.lastIndexOf("\t"));
        if (breakAt > SEGMENT_CHAR_LIMIT / 2) stop = start + breakAt;
        const code = text.charCodeAt(stop - 1);
        if (code >= 0xd800 && code <= 0xdbff) stop--;
      }
      let trimmedEnd = stop;
      while (trimmedEnd > start && /\s/.test(text[trimmedEnd - 1]!)) trimmedEnd--;
      if (trimmedEnd > start) {
        const covered = pages.filter((page) => page.startOffset < trimmedEnd && page.endOffset > start);
        const sequence = segments.length + 1;
        segments.push({
          id: `${agreementId}:v${version}:s${sequence}`, agreementId, version, sequence,
          text: text.slice(start, trimmedEnd), startOffset: start, endOffset: trimmedEnd,
          pageStart: covered[0]?.pageNumber ?? null, pageEnd: covered.at(-1)?.pageNumber ?? null,
        });
      }
      start = stop;
    }
  }
  return segments;
}
