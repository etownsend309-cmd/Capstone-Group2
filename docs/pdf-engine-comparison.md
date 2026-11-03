# PDF extraction engine decision

## Decision

Retain PDF.js and ClausePilot's existing coordinate-first/content-order
fallback for the next milestone. Do not add PyMuPDF or pdfplumber to the
application.

PyMuPDF had the strongest measured extraction result, but its advantage over
PDF.js was too small to justify moving contract extraction to a Python service
and taking on its AGPL/commercial-license constraint. Revisit this decision
only if broader evaluation finds document classes where PDF.js loses material
text or reading order.

## Measured results

The deterministic sample contains 30 CUAD v1 contracts, covers all 12
ClausePilot categories, and uses the matching CUAD TXT conversion as the common
reference. All four strategies successfully extracted all 30 documents with no
empty pages or parser failures.

- PyMuPDF: 99.53% mean token F1, 99.57% reading-order similarity, and 31.61 ms
  median latency.
- PDF.js coordinate order: 99.49% F1, 99.08% reading order, and 57.84 ms median
  total PDF.js extraction latency.
- pdfplumber: 99.45% F1, 99.42% reading order, and 401.82 ms median latency.
- PDF.js content-stream order: 99.33% F1, 99.33% reading order, and 57.84 ms
  median total PDF.js extraction latency.

PyMuPDF led PDF.js coordinate order by 0.04 percentage points in F1 and 0.49
points in reading order. That is measurable but not a material quality gain for
this architecture. pdfplumber provided no quality advantage and was roughly
seven times slower than PDF.js at the median.

The generated multi-column fixture remains important: PDF.js coordinate order
scored 100% reading-order similarity there, while content-stream order,
PyMuPDF, and pdfplumber scored 60.6%. It supports keeping ClausePilot's current
coordinate-first selection with content order as a safety net.

## Why PDF.js remains the choice

- It is already integrated with the React/TypeScript browser workflow.
- It keeps contract bytes client-side under the current prototype architecture.
- Its Apache-2.0 license fits the project.
- Its extraction quality was within 0.04 F1 percentage points of the measured
  leader.
- Switching to either Python engine would require a server extraction service,
  upload security controls, retention policy, monitoring, and operational
  ownership.

PyMuPDF requires an explicit AGPL-3.0 compliance or commercial-license
decision before production use. pdfplumber is MIT-licensed but still requires
a server-side Python runtime. API keys are not relevant to these local parsers,
and no future AI or OCR service key may be placed in frontend code.

## Limitations

- CUAD TXT files are conversions, not authoritative page-layout ground truth,
  and may favor extraction behavior similar to the converter that produced
  them.
- Latency is one local run. PDF.js parses once and constructs both strategies,
  so its reported time is total extraction time rather than an isolated
  per-strategy parser time.
- The sample had selectable text in every document. The separate image-only
  fixture confirms that none of these engines performs OCR.
- The extracted dataset contains 510 PDFs and 510 TXT files, and all 30 selected
  pairs were found. The original ZIP was not retained locally, so its published
  MD5 `c38f490a984420b8a62600db401fafd5` could not be rechecked after extraction.
- PyMuPDF 1.28.2 was used because the available package index did not carry the
  planned 1.28.5 patch.

Keep the explicit plaintext fallback and treat OCR as a separate product,
privacy, and deployment decision.
