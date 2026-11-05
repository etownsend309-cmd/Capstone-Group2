export type IngestionState = "pending" | "ready" | "failed";

export interface SourcePage {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
}

export interface AgreementSegment {
  id: string;
  agreementId: string;
  version: number;
  sequence: number;
  text: string;
  startOffset: number;
  endOffset: number;
  pageStart: number | null;
  pageEnd: number | null;
}

export interface IngestionSummary {
  version: number;
  state: IngestionState;
  error: string | null;
  segmentCount: number;
}

export interface IngestionRecord extends IngestionSummary {
  agreementId: string;
  source: "extracted" | "supplied";
  text: string;
  pages: SourcePage[];
  segments: AgreementSegment[];
  pageCount: number | null;
  strategy: string | null;
  warnings: string[];
}

export interface IngestionInput {
  version: number;
  text?: string;
  source?: "extracted" | "supplied";
  pages?: SourcePage[];
  pageCount?: number;
  strategy?: string;
  warnings?: string[];
  failed?: boolean;
}
