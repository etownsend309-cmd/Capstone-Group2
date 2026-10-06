# Private fixtures (never committed)

Everything in this directory except this README and `.gitkeep` is ignored by git
(see the root `.gitignore`).

Use this directory when you want to evaluate the proof of concept against a real
or representative agreement that must not leave your machine.

## How to test a private PDF safely

1. Copy the PDF here, for example `fixtures/private/vendor-agreement.pdf`.
2. Start the app with `npm run dev` and open it in your browser.
3. Choose the file through the upload panel. There is no server: the file is read
   into memory in the browser tab, parsed by PDF.js, and dropped when you press
   Reset or reload the page. Nothing is uploaded and nothing is written to disk.
4. If you export a report, save it outside the repository or into
   `artifacts/local/`, which is git-ignored. Leave the "include text excerpts"
   box unchecked unless you have a reason to include contract content.

## How to benchmark a private PDF

```bash
npm run benchmark -- --fixtures-dir fixtures/private --out-dir artifacts/local
```

`artifacts/local/` is git-ignored. Do not move those files into `artifacts/`.

Without a `fixtures.json` manifest the benchmark just scans the directory for
`.pdf` files, so no per-file setup is needed. It has no ground-truth text to
compare against, so the coverage and reading-order columns will be blank; the
status, page count, latency, and character counts are still recorded.

## Rules

- Do not commit real vendor agreements, signed contracts, or customer data.
- Do not paste contract text into commit messages, issues, or the shared report.
- Automated tests must use `fixtures/generated/` only.
- Before pushing, run `git status` and confirm nothing from this directory is staged.
