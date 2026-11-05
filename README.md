# Capstone-Group2

Source code for MIST capstone project.

The repository holds three things:

1. **ClausePilot**, an AI-assisted agreement review prototype. This is the default view.
2. The **PDF text extraction harness** from Jira ticket KAN-402, kept as a
   separate view so its measurements stay reproducible.
3. An authenticated Netlify Function that uses the OpenAI Responses API for
   first-pass clause classification.

PDF extraction and review storage remain in the browser. Extracted text is sent
to the serverless classifier when it is configured. There is no database, and
the Python PDF-engine comparison is isolated from the application runtime.

## ClausePilot: the agreement review prototype

A local, testable first-pass workflow for vendor agreements. It can:

- accept text-based PDF and TXT agreements;
- extract PDF text in the browser;
- identify the team's **12 approved CUAD playbook categories** through the
  OpenAI Responses API;
- reject AI findings unless their supporting quote matches extracted text
  exactly;
- attach a non-calibrated confidence indicator and supporting source text to
  every AI finding;
- let a reviewer accept, dismiss, escalate, or manually add findings;
- complete a review and show category-level reporting;
- switch between Requester, Reviewer, Approver, and Administrator views; and
- keep review records in browser storage.

If AI classification is unavailable, the agreement is still created for manual
classification. **This prototype sends extracted agreement text to OpenAI and
keeps review records in browser storage, so do not use real confidential
agreements without organizational approval.**

### The 12 approved categories

Governing Law, Anti-Assignment, Cap On Liability, Audit Rights, Termination For
Convenience, Exclusivity, Renewal Term, Insurance, Change Of Control, Uncapped
Liability, Notice Period To Terminate Renewal, Warranty Duration.

Indemnification is deliberately **not** a standalone category. The demo
agreement contains indemnification language so that Uncapped Liability has
something to match, but no finding is produced for indemnification itself.
`tests/unit/analyze.test.ts` asserts both the category list and the fact that
the demo agreement exercises all 12.

## The KAN-402 extraction harness

The capstone needs to read text out of vendor agreement PDFs. Before building
anything on that assumption, KAN-402 asked three questions:

1. How well does PDF.js read a contract PDF?
2. What happens when it cannot read one?
3. When should the team stop trying and ask for supplied plaintext instead?

The harness answers those by parsing a PDF in the browser, reconstructing the
text two different ways, measuring both, and refusing to call an empty result a
success. Findings and the provisional recommendation are in
[`docs/pdf-extraction-poc.md`](docs/pdf-extraction-poc.md); the measured numbers are in
[`artifacts/pdf-benchmark-results.md`](artifacts/pdf-benchmark-results.md).

ClausePilot uses the same engine (`src/pdf/`) through a thin adapter at
`src/lib/extractText.ts`, which also adds TXT support. The adapter prefers the
coordinate reconstruction strategy, because the benchmark shows the two
strategies tie on single-column documents while stream order interleaves the
columns of a two-column agreement.

## Requirements

- Node.js 22.12 or newer. `.nvmrc`, `package.json`, and the Netlify build
  configuration pin 22.12 because `@netlify/identity` requires it.
- npm

## Installation

```bash
git clone https://github.com/etownsend309-cmd/Capstone-Group2.git
cd Capstone-Group2
npm install
```

To run the browser tests you also need Playwright's browsers once:

```bash
npx playwright install chromium
```

## Running the app

For the complete AI-assisted flow, configure the server-only API key and
`OPENAI_MODEL` as scoped Netlify environment variables (see `.env.example`),
then run through Netlify Dev or a Netlify deploy. The Function accepts
`OPENAI_API_KEY`, or the existing Netlify secret `Group2_API_Key` when the
conventional name is absent. The repository's default model name came from the
approved implementation plan, not from a successful live request; verify access
and explicitly approve the model before staging.

```bash
npx netlify dev
```

Never put the key in a `VITE_` variable. `npm run dev` still starts the
frontend alone; because no Function is available there, submission deliberately
falls back to manual classification.

Netlify normally uses the build Node version for Functions, so `netlify.toml`
pins Node 22.12. If a site overrides the Function runtime with
`AWS_LAMBDA_JS_RUNTIME`, set that variable in Netlify (not `netlify.toml`) to a
compatible Node 22 runtime before deploying.

For frontend-only development:

```bash
npm run dev
```

Then open <http://127.0.0.1:5173>. Choose **New agreement**, then **Load demo agreement** to fill the submission
form with sample metadata and a document. Click **Create review** to submit it
and view its reference and status in **My submissions**.

The extraction harness is at <http://127.0.0.1:5173/?view=extraction-poc>, also
reachable from the link at the bottom of the sidebar. Drop a PDF onto its upload
panel, label it, and press **Run extraction**.

To check a production build locally:

```bash
npm run build
npm run preview
```

## Commands

| Command                | What it does                                                     |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run dev`          | Start the Vite dev server                                        |
| `npm run build`        | Typecheck, then build for production into `dist/`                |
| `npm run preview`      | Serve the production build                                       |
| `npm run typecheck`    | TypeScript with no emit, across app and scripts                  |
| `npm run lint`         | ESLint checks application, scripts, config and test code         |
| `npm run lint:fix`     | Apply safe automated ESLint fixes                               |
| `npm test`             | Vitest: unit and component tests                                 |
| `npm run test:e2e`     | Playwright browser tests                                         |
| `npm run test:e2e:landing` | Chromium smoke test of the default landing page and browser errors |
| `npm run evaluate:ai:baseline` | Evaluate the local-rule baseline against the 30-agreement CUAD manifest |
| `npm run evaluate:ai:cuad` | Evaluate the configured OpenAI model against the CUAD development set |
| `npm run evaluate:ai:holdout -- --manifest … --dataset-root …` | Run the sealed 10-agreement holdout after configuration is frozen |
| `npm run fixtures`     | Regenerate the test PDFs in `fixtures/generated/`                |
| `npm run benchmark`    | Measure every fixture and rewrite `artifacts/pdf-benchmark-results.{json,md}` |

### Why the fixtures are committed

`fixtures/generated/` is checked in rather than built on demand, so `npm test`
works on a fresh clone and the benchmark numbers describe the same documents
everyone else has.

Generation is deterministic: the document timestamps are pinned in
`scripts/generateFixtures.ts`, so `npm run fixtures` reproduces byte-identical
files. If regenerating ever does change them, the content genuinely changed, and
the benchmark should be re-run so `artifacts/` stays consistent.

### Two layers of test, on purpose

`npm test` covers the playbook rules, the extraction logic against the real
fixture PDFs, and the harness UI rendered under jsdom. It needs nothing but
Node.

`npm run test:e2e` covers the same UI behaviour in a real browser, where a real
PDF.js worker and real file downloads are involved. It needs a browser, so it is
kept separate rather than being the only thing that verifies the interface.

`npm run test:e2e` runs all configured projects unless one is selected:
`--project=chromium`,
`--project=firefox`, or `--project=chrome` to drive a Google Chrome that is
already installed instead of downloading Playwright's own Chromium — useful on a
machine or network that cannot reach the Playwright CDN.

## KAN-29 quality checks

ESLint uses the JavaScript and TypeScript recommended flat configurations.
Application files use browser globals; scripts, configuration and test files
use Node globals. Dependencies, build output, reports and PDF fixtures are
excluded. Warnings fail `npm run lint`; TypeScript remains a separate check.

The landing-page test opens `/` in an isolated Playwright context, verifies
the overview heading, navigation, summary, empty state and eight workflow
stages, and fails on console errors or uncaught page exceptions. Error listeners
are attached before navigation. This test does not replace the extraction suite.

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e:landing
```

If the browser CDN is unavailable but Google Chrome is installed, use
`npm run test:e2e -- tests/e2e/landing.spec.ts --project=chrome`.
Listing tests with `--list` verifies discovery only, not a browser pass.

The `KAN-29 checks` GitHub Actions workflow runs a clean installation, lint,
TypeScript checks, unit/component tests, the production build and the Chromium
landing-page test on pushes and pull requests. Results appear in the repository's
Actions tab. The workflow can also be started manually with **Run workflow**.

The KAN-29 ESLint configuration and landing-page test were predominantly
AI-generated with ChatGPT Codex for Nadia Densu. Record module ownership and
comprehension review in the KAN-72 provenance log.

## Technology stack

| Purpose             | Choice                                    |
| ------------------- | ----------------------------------------- |
| UI                  | React 19 + TypeScript 5.9                 |
| Build / dev server  | Vite 7                                    |
| PDF parsing         | `pdfjs-dist` 6.3.289 (PDF.js, legacy build) |
| Serverless API      | Netlify Functions, Node.js and TypeScript |
| AI classification  | OpenAI Responses API with strict Zod structured output |
| Authentication     | Netlify Identity                         |
| Unit and component tests | Vitest 5 (Node, plus jsdom for components) |
| Browser tests       | Playwright                                |
| Fixture generation  | `pdf-lib` and `jimp`                      |

The PDF.js **`legacy`** build is used in both the browser and the Node scripts.
Using one build means the benchmark measures the same code path the app runs.

## Layout

```
src/App.tsx       ClausePilot: shell, intake, review queue, decisions, reports
src/lib/          Playbook analyzer and the extraction adapter
src/pdf/          PDF.js driver, the two reconstruction strategies, measurement, report
src/poc/          The KAN-402 extraction harness and its components
src/shared/       Browser/server classifier contracts and approved categories
netlify/functions/  Authenticated AI classification endpoint and validators
scripts/          Fixture generator and benchmark runner (TypeScript, run with tsx)
tests/unit/       Vitest: pure functions, real-fixture extraction, jsdom component tests
tests/e2e/        Playwright browser tests
fixtures/generated/  Committed synthetic PDFs plus their expected text
fixtures/private/    Git-ignored space for approved local PDFs
artifacts/        Committed benchmark output
docs/             Written findings
```

The two views own separate global stylesheets that both style `body`, `button`,
and `.panel`. `src/main.tsx` imports one view and its stylesheet on demand so
the two never collide.

### A note on `index.html`

The repository's original `index.html` landing page is now the Vite entry point,
because Vite requires `index.html` at the project root. Its original sentence is
preserved inside the `<noscript>` block, so it is still what a visitor sees
without JavaScript.

## Testing a private or real PDF

Put it in `fixtures/private/`, which is git-ignored, and follow
[`fixtures/private/README.md`](fixtures/private/README.md). Automated tests use
only `fixtures/generated/`.

## Privacy

This is an evaluation integration, not approved production architecture.

- PDFs are processed in the browser and are not uploaded. Extracted text is sent
  through the authenticated Netlify Function to OpenAI for classification.
- The Function requests `store: false` and does not log agreement text, model
  output, or supporting quotes. Organizational OpenAI retention terms still
  require approval before real confidential use.
- Provider calls have a 25-second overall deadline and at most one SDK retry,
  leaving headroom inside Netlify's synchronous Function execution limit.
- The API key is a server-only Netlify secret, stored as `OPENAI_API_KEY` or
  the existing `Group2_API_Key` variable. Never prefix either name with
  `VITE_`, commit its value, return it to the browser, or include it in logs.
- No uploaded PDF is stored. Resetting or reloading discards it.
- ClausePilot keeps agreement records, including extracted text, in this
  browser's `localStorage`. Clear site data to remove them.
- Exported harness reports contain metrics and your notes, not extracted text,
  unless you explicitly opt in — and then only a 300-character excerpt.
- Do not commit real agreements. `fixtures/private/`, `artifacts/local/`, and
  exported `pdf-extraction-report-*` files are git-ignored.

## AI evaluation

The 30-agreement CUAD manifest is the development/evaluation set for
per-category precision, recall, and F1. Run its deterministic local-rule
baseline with `npm run evaluate:ai:baseline`. OpenAI evaluation additionally
requires the same server-only API key as the Function (`OPENAI_API_KEY` or
`Group2_API_Key`); it uses the same prompt, strict schema, exact-quote
validator, `store: false` setting, and configurable `OPENAI_MODEL` as the
Netlify Function.

Reports written to `artifacts/` contain document IDs, category outcomes,
aggregate metrics, configuration versions, latency, and token totals. They
exclude agreement text and source quotes. Failed requests count as empty
predictions instead of silently disappearing from the denominator.

The 10 modified agreements are a separate sealed holdout. They must not be
used for prompt, model, or threshold selection. The holdout command refuses to
run unless its manifest has exactly 10 records and `--frozen-config` is set by
the package script. The holdout files and locked answer key are not included in
this repository; provide their paths with `--manifest` and `--dataset-root`
only after configuration is frozen.

## Known limitations

### The review workflow

- **Model confidence is not evaluated reliability.** Low, medium, and high are
  model self-assessments. They are not probabilities and do not automate review
  decisions.
- **One AI provision per category.** Gaps remain manual in the first milestone.
- **Browser storage only.** Records live in `localStorage`, are not shared
  between browsers or machines, and have no migration path.
- **Authentication without resource authorization.** The Function verifies a
  Netlify Identity user, but browser-only agreements give it no durable record
  against which to enforce ownership or reviewer roles.
- **Not wired yet:** database persistence, server-enforced agreement ownership,
  calibrated confidence thresholds, and production rate/cost controls.

### Extraction

- **No OCR.** PDF.js reads a PDF's existing text layer. A scanned or
  image-only PDF has none, so extraction correctly returns nothing and the
  reviewer is told why. OCR is a separate technology decision; see the OCR
  research note in [`docs/pdf-extraction-poc.md`](docs/pdf-extraction-poc.md).
- **Two strategies, one engine.** Both strategies read the same PDF.js parse.
  They compare ways of *reconstructing* text, not competing PDF engines.
- **The coordinate strategy is an experiment,** not a layout engine. It handles
  one column gutter per page; tables and rotated text are not reconstructed
  faithfully.
- **The low-text threshold is a heuristic** (fewer than 50 printable characters
  per page), not a confidence score.
- **Character count measures volume, not quality.** The multi-column fixture
  produces identical counts from both strategies in completely different reading
  orders.
- **No password-protected PDF support.** Encrypted files are reported as a
  failure with the fallback offered.
- **Not production architecture.** Authentication exists, but agreement
  persistence and authorization remain browser-only prototypes.
