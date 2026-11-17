# Agreement ingestion and segmentation

KAN-53 implements text preparation independently of provision identification.

## Workflow

1. Submission creates the agreement and a version-1 ingestion record in `pending` state.
2. The original document is uploaded through the existing private document API.
3. The browser extracts text and posts it to the separate ingestion endpoint.
4. The server validates source locations, creates ordered sections and persists `ready` or `failed` state.
5. A failed or interrupted preparation remains visible in My submissions and the review workspace. Retry the saved document or supply readable agreement text.
6. Ready text supports manual provision identification through the existing manual-flag workflow. Ingestion does not call an AI provider, create gap findings or compare standard positions.

Submission success confirms that the agreement record was saved. Text preparation has its own status. A failed original-file upload is reported separately; supplied text remains available for recovery.

## Source contract

`src/shared/ingestion.ts` defines the shared API types.

Each section includes an agreement ID, ingestion version, deterministic section ID, one-based sequence, exact text, start/end offsets and optional PDF page numbers.

Offsets are zero-based JavaScript UTF-16 string positions into the exact stored ingestion text. The end offset is exclusive. `text.slice(startOffset, endOffset)` reproduces the section exactly. Section boundaries follow blank lines, recognizable numbered or uppercase headings, PDF page boundaries and a maximum of 1,800 characters. Long sections split at whitespace where practical. This is deterministic structural segmentation, not a guarantee that each section is a complete legal clause.

Page numbers are one-based and come from the selected PDF extraction strategy. Supplied text and TXT uploads have no verified PDF page mapping; page fields remain null. Whitespace between sections is preserved in the stored source text. Source text is not normalized after segmentation.

## API

`POST /api/agreements` accepts `deferIngestion: true` with an empty `rawText` to create a pending ingestion. Existing callers supplying readable text without this flag retain their prior behavior.

`GET /api/agreements/{id}/ingestion` returns the latest ingestion record and its ordered sections.

`POST /api/agreements/{id}/ingestion` accepts a positive `version` and either:

- `text`, `source` (`extracted` or `supplied`), optional `pages`, `pageCount`, `strategy` and `warnings`.
- `failed: true` to record an extraction failure with a safe recovery message.

Submitted text is resegmented on the server. Client-provided section IDs or section arrays are not trusted. Supplied text cannot claim PDF page locations.

Repeated identical ready-source requests return the existing sections without duplicate audit events. Concurrent preparation requests are serialized by a database row lock. A different source for a ready version returns HTTP 409. Database triggers also prevent ready-source replacement. Requesters can access only their own agreements; authorized reviewers can prepare accessible agreements. Preparation cannot replace text after review starts. Review decisions and completion are blocked while preparation is pending or failed. Supplying text restores the manual-review path.

## Database

Apply the existing migrations followed by:

`netlify/database/migrations/20261105090000_agreement_ingestion.sql`

Apply this migration before deploying the updated API. It creates the ingestion table, constraints, row-level policies, grants and ready-source protection. It does not modify existing agreement, finding or audit records. The existing API integration suite applies the complete migration directory to an empty local database.

Legacy agreements continue to use their existing stored text and findings. New deferred submissions use the ingestion source for manual source-text validation. This ticket starts new submissions at version 1; creating revisions and linked review cycles remains KAN-42 work. Future revision creation must create the corresponding ingestion version rather than overwrite ready evidence.

## Recovery and limitations

Extraction still runs in the submitting browser. Closing the page or losing the session can leave preparation pending. After signing in, retry the privately stored document or supply text. This is an explicit recovery flow, not a durable server-side extraction queue. PDF extraction remains subject to the existing timeout and extraction limitations; this work does not add OCR.

An empty or scanned PDF must not be interpreted as evidence that provisions are absent. No classification or gap detection runs during ingestion. The original document and its supplied text should be checked by the reviewer.

## Verification

```sh
npm ci
npm run lint
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npx playwright install chromium
npx playwright test tests/e2e/ingestion.spec.ts tests/e2e/intake.spec.ts tests/e2e/landing.spec.ts --project=chromium
```

Unit coverage checks exact offsets, ordering, page locations, repeated text, Unicode, empty pages and long sections. API integration coverage uses the actual migrations and row-level policies to check persistence, safe reruns, concurrent requests, failed-state recovery, cross-user denial, stale versions, immutable source evidence and completion gates. Browser coverage checks successful preparation, failed extraction, supplied-text recovery, interrupted preparation, retry, reload and normal intake.

## Recorded validation

Prepared against Capstone-Group2 main commit `c5cf295fc3ffa2e85476dc7478c20c38365d4a98`.

- Lint: passed with zero warnings.
- TypeScript checks for browser, build tooling and server: passed.
- Vitest: 276 tests passed across 18 files, including database/API integration tests.
- Chromium browser suite: all 42 tests passed, including the three new ingestion journeys.
- Production build: passed.
- Patch whitespace checks: passed.

Browser tests used the existing in-memory API fixture; integration tests exercised the actual request handler, migrations and row-level policies against local Postgres. No production database migrations or deployments were performed. The extraction-harness keyboard test now waits for its lazily loaded skip link to mount before sending Tab, preserving the existing keyboard-focus assertion.
