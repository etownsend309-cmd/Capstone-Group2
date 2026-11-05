import type { IngestionRecord } from "../shared/ingestion";

export interface SourceLocation {
  startOffset: number;
  endOffset: number;
  pageStart: number | null;
  pageEnd: number | null;
  sections: number[];
}

export function locateSource(text: string, citation: string, record?: IngestionRecord): SourceLocation[] {
  if (!citation.trim()) return [];
  const verified = record?.state === "ready" && record.text === text ? record : undefined;
  const matches: SourceLocation[] = [];
  let start = text.indexOf(citation);
  while (start !== -1 && matches.length < 100) {
    const end = start + citation.length;
    const pages = (verified?.source === "extracted" ? verified.pages : []).filter((page) =>
      Number.isInteger(page.pageNumber) && page.pageNumber > 0 &&
      (verified?.pageCount == null || page.pageNumber <= verified.pageCount) &&
      Number.isInteger(page.startOffset) && Number.isInteger(page.endOffset) &&
      page.startOffset >= 0 && page.endOffset <= text.length && page.endOffset > page.startOffset &&
      page.startOffset < end && page.endOffset > start);
    const covered = pages.length > 0 && pages[0]!.startOffset <= start && pages.at(-1)!.endOffset >= end &&
      pages.every((page, index) => index === 0 || (page.pageNumber > pages[index - 1]!.pageNumber && page.startOffset <= pages[index - 1]!.endOffset));
    matches.push({ startOffset: start, endOffset: end,
      pageStart: covered ? pages[0]!.pageNumber : null,
      pageEnd: covered ? pages.at(-1)!.pageNumber : null,
      sections: (verified?.segments ?? []).filter((segment) =>
        segment.agreementId === verified?.agreementId && segment.version === verified?.version &&
        Number.isInteger(segment.sequence) && segment.sequence > 0 &&
        Number.isInteger(segment.startOffset) && Number.isInteger(segment.endOffset) &&
        segment.startOffset >= 0 && segment.endOffset <= text.length && segment.endOffset > segment.startOffset &&
        text.slice(segment.startOffset, segment.endOffset) === segment.text &&
        segment.startOffset < end && segment.endOffset > start).map((segment) => segment.sequence),
    });
    start = text.indexOf(citation, start + 1);
  }
  return matches;
}
