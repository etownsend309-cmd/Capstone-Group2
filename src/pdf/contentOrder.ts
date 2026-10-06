/**
 * Strategy A: PDF content-stream order.
 *
 * PDF.js returns text fragments in the order they appear in the page's content
 * stream. This strategy simply concatenates them and breaks a line wherever
 * PDF.js sets `hasEOL`.
 *
 * This is the cheapest possible reconstruction and it is correct whenever the
 * producing application wrote the content stream in reading order, which most
 * word processors do. It has no idea where anything is on the page, so if the
 * producer interleaved two columns in the stream, the output is interleaved too.
 */

import type { TextFragment } from "./types";

export function buildContentOrderText(fragments: TextFragment[]): string {
  let out = "";
  for (const fragment of fragments) {
    out += fragment.text;
    if (fragment.hasEOL) out += "\n";
  }
  return collapseBlankRuns(out);
}

/** Three or more consecutive newlines add nothing but noise to a diff. */
export function collapseBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trimEnd();
}
