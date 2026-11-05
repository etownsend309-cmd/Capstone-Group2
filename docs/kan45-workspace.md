# KAN-45: Agreement and source text review workspace

## Delivery

Based on KAN-53 commit `8fbf4f81380390f50f76a69e2d63f0be3885c2d6`. KAN-53 PR #11 supplies the persisted ingestion record, source pages, sections and recovery flow. Apply this change on a branch created from KAN-53, or on main after that PR merges.

## Behavior

- Authorized users can open stored PDF/TXT originals beside the complete extracted or supplied agreement text. Original-file retrieval uses the existing authenticated document endpoint; files remain private.
- A finding's **Go to cited text** button highlights and focuses its exact supporting passage. Repeated passages have an occurrence selector. Unmatched excerpts are clearly identified instead of assigned an invented location.
- Source metadata identifies the ingestion version, character range, section and verified PDF page where available. Supplied text has no invented page mapping. Gap findings do not create or highlight a source span.
- If extraction is missing, the original remains available for manual inspection and download. Retry or supply verified text through the existing preparation controls. Exact-text provision flags require prepared text; the application does not complete a review or assert a gap merely because extraction failed.
- Failed document retrieval shows a retry action while retaining the stored source text. No original file shows an explicit unavailable message.
- Requester API responses omit reviewer notes and internal history snapshots. Reviewer/Administrator access retains them. The Requester view hides the note field and history.
- Document previews are discarded when the workspace closes or changes documents. The browser's native PDF viewer handles inline display; download is available when it cannot display the file.

## Related work

| Ticket | Boundary |
| --- | --- |
| KAN-53 | Reuses ingestion, exact source text, page/section metadata and recovery; no second segmentation implementation |
| KAN-41 | Reuses private document retrieval; upload validation, storage limits and upload cleanup remain that ticket's scope |
| KAN-46 | Reuses manual flag creation/editing; navigation supports its evidence without replacing its forms |
| KAN-43 | Fixes note disclosure in requester-facing API detail responses as well as the review screen |
| KAN-35 | Reuses database authorization; does not replace the full role and Approver permission matrix |
| KAN-54 | Does not change classifier contracts or invent offsets for nonmatching classifier excerpts |
| KAN-73 | Uses current application styles and responsive layout; does not define a replacement design system |

## Validation

Local validation passed: lint; frontend/tooling/server type checking; production build; 288 unit/integration tests in 20 files; and 45 Chromium browser tests. Browser tests use a fake API and seeded sessions. API integration tests exercise the actual handler and local database policies with an in-memory file store.

Source-location tests cover repeated citations, UTF-16 offsets, cross-page spans, invalid metadata, stale source metadata, supplied-text page handling and unmatched citations. Component tests cover focus/highlighting, gap handling, missing extraction, denied file access and safe TXT rendering. API tests verify requester note/history protection and retained reviewer access; existing tests cover unauthenticated and cross-user document access. Browser tests exercise source navigation, responsive layout, extraction failure/recovery and inaccessible originals alongside the existing regression suite.

```bash
npm ci
npm run lint
npm run typecheck
npm test -- --maxWorkers=2
npm run build
npx playwright install chromium
npm run test:e2e -- --project=chromium
```

The existing `.github/workflows/kan29-checks.yml` now includes the workspace browser tests alongside intake and ingestion checks. Its KAN-29 filename remains because this is the shared quality workflow.

## Release acceptance

Merge/review the KAN-53 dependency and its ingestion migration before publishing the combined application. No additional database migration is introduced here. Confirm the Actions run for the uploaded commit, then check the Netlify preview with separate controlled accounts: open an original, jump to a citation, inspect/recover a failed extraction, verify cross-requester access is refused, and confirm requester detail responses contain neither notes nor internal snapshots. Local automation is not a claim that these changes are already deployed.
