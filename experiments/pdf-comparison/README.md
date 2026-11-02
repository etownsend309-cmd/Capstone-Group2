# PDF engine comparison

This experiment compares ClausePilot's existing PDF.js extraction with PyMuPDF
and pdfplumber. It is isolated from the application runtime: the Python
packages are installed only in this directory's ignored `.local/python`, and the
React/Vite dependency graph is unchanged.

## Data and privacy

The benchmark uses a deterministic 30-contract sample from CUAD v1. The source
archive is downloaded from the [official Zenodo record](https://zenodo.org/records/4595826)
and verified against its published MD5:

`c38f490a984420b8a62600db401fafd5`

PDFs remain under the external dataset directory
(`/Users/jskelton/Desktop/CUAD_v1` by default). Extracted contract text and
per-engine intermediates are written only to the ignored `.local` directory.
Committed manifests and reports contain filenames, aggregate metrics, status,
timing, and warning summaries, but no contract text. Do not move source PDFs or
`.local` output into tracked paths.

## Reproduce

Prerequisites are the repository's existing Node dependencies, Python 3, and
network access for the official CUAD archive and Python packages.

```sh
npm run compare:pdf:setup
npm run compare:pdf:prepare
npm run compare:pdf:sample
npm run test:pdf-comparison
npm run compare:pdf
```

To validate all four adapters without CUAD, run the non-representative generated
fixture smoke test:

```sh
npm run compare:pdf -- \
  --dataset-root fixtures/generated \
  --manifest experiments/pdf-comparison/manifests/synthetic-smoke.json \
  --out-dir experiments/pdf-comparison/.local/smoke-report
```

If the official archive was downloaded separately, avoid another network
request while retaining checksum verification:

```sh
PYTHONPATH=experiments/pdf-comparison/.local/python python3 \
  experiments/pdf-comparison/prepare_dataset.py \
  --archive /absolute/path/to/CUAD_v1.zip \
  --dataset-root /absolute/path/to/CUAD_v1
```

For a non-default dataset location, invoke `select_sample.py` and
`runComparison.ts` directly with `--dataset-root`.

The final sanitized outputs are:

- `artifacts/pdf-engine-comparison.json`
- `artifacts/pdf-engine-comparison.md`

Quality is measured against CUAD's supplied TXT conversions using token
precision, token recall, token F1, and longest-common-subsequence reading-order
similarity. Those TXT files are practical references, not authoritative
page-layout ground truth. Latency is one local run and should be treated as a
relative observation, not a production performance guarantee.

## Engines and licensing

- PDF.js: Apache-2.0; already used in ClausePilot and runs in the browser.
- pdfplumber: MIT; Python/server-side only.
- PyMuPDF: AGPL-3.0 or commercial licensing. It is included here for
  evaluation only. Production adoption requires an explicit license and
  architecture review.

This experiment does not include OCR. Scanned or image-only documents should
be reported as extraction failures rather than silently treated as successful.
