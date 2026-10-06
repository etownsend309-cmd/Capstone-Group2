/**
 * Run both PDF.js extraction strategies against every generated fixture and
 * write the real measurements to artifacts/.
 *
 *   npm run benchmark
 *   npm run benchmark -- --fixtures-dir fixtures/private --out-dir artifacts/local
 *
 * This runs in plain Node against PDF.js' `legacy` build, which is the same
 * module the browser app imports, so the numbers describe the same code path.
 * No browser and no Python are required.
 *
 * Nothing here fabricates results. A fixture that fails is recorded as failed.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractPdf, PDFJS_VERSION } from "../src/pdf/extractPdf.js";
import { compareToGroundTruth, type SimilarityScore } from "../src/pdf/similarity.js";
import { LOW_TEXT_THRESHOLD_PER_PAGE } from "../src/pdf/evaluateExtraction.js";
import type { ExtractionRun, StrategyResult } from "../src/pdf/types.js";
import type { FixtureManifestEntry } from "./generateFixtures.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

/** Each fixture is measured this many times; the fastest run is reported. */
const REPEATS = 3;

interface Args {
  fixturesDir: string;
  outDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    fixturesDir: path.join(REPO_ROOT, "fixtures", "generated"),
    outDir: path.join(REPO_ROOT, "artifacts"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--fixtures-dir" && value) args.fixturesDir = path.resolve(REPO_ROOT, value);
    if (flag === "--out-dir" && value) args.outDir = path.resolve(REPO_ROOT, value);
  }
  return args;
}

interface StrategyRow {
  strategy: string;
  strategyName: string;
  status: string;
  /** Fastest of REPEATS, in milliseconds. */
  reconstructionMs: number;
  pageCount: number;
  characterCount: number;
  printableCharacterCount: number;
  charactersPerPage: number[];
  emptyPages: number[];
  pagesWithText: number;
  fallbackRecommended: boolean;
  fallbackReasons: string[];
  warnings: string[];
  groundTruth: SimilarityScore | null;
}

interface FixtureRow {
  id: string;
  file: string;
  category: string;
  description: string;
  expectation: string;
  sizeBytes: number;
  pageCount: number;
  overallStatus: string;
  /** Fastest end-to-end parse + reconstruct time, in milliseconds. */
  totalMs: number;
  looksScanned: boolean;
  error: string | null;
  documentWarnings: string[];
  fallbackRecommended: boolean;
  fallbackReasons: string[];
  /** Did the observed behaviour match what the fixture was built to do? */
  matchedExpectation: boolean;
  strategies: StrategyRow[];
}

interface BenchmarkOutput {
  generatedAt: string;
  library: { name: string; version: string };
  runtime: { node: string; platform: string; arch: string };
  settings: { repeats: number; lowTextThresholdPerPage: number; fixturesDir: string };
  notes: string[];
  fixtures: FixtureRow[];
}

/** Every .pdf under `dir`, recursively, as paths relative to `dir`. */
async function findPdfs(dir: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      found.push(...(await findPdfs(dir, relative)));
    } else if (entry.name.toLowerCase().endsWith(".pdf")) {
      found.push(relative);
    }
  }
  return found.sort();
}

async function loadManifest(dir: string): Promise<FixtureManifestEntry[]> {
  try {
    const raw = await readFile(path.join(dir, "fixtures.json"), "utf8");
    return (JSON.parse(raw) as { fixtures: FixtureManifestEntry[] }).fixtures;
  } catch {
    // No manifest (for example fixtures/private): benchmark every PDF we find.
    return (await findPdfs(dir)).map((file) => ({
      id: file.replace(/\.pdf$/i, ""),
      file,
      category: "unknown" as const,
      expectedText: null,
      description: "Local PDF discovered without a manifest entry.",
      expectation: "unspecified" as const,
    }));
  }
}

/** Did the fixture behave the way it was built to behave? */
function checkExpectation(entry: FixtureManifestEntry, run: ExtractionRun): boolean {
  switch (entry.expectation) {
    case "extractable":
      return run.status !== "failed" && run.strategies.some((s) => s.printableCharacterCount > 0);
    case "no-text-layer":
      return run.strategies.every((s) => s.printableCharacterCount === 0) && run.looksScanned;
    case "unparseable":
      return run.status === "failed";
    default:
      return true;
  }
}

function toStrategyRow(
  strategy: StrategyResult,
  fastestMs: number,
  groundTruth: SimilarityScore | null,
): StrategyRow {
  return {
    strategy: strategy.strategy,
    strategyName: strategy.strategyName,
    status: strategy.status,
    reconstructionMs: round2(fastestMs),
    pageCount: strategy.pageCount,
    characterCount: strategy.characterCount,
    printableCharacterCount: strategy.printableCharacterCount,
    charactersPerPage: strategy.charactersPerPage,
    emptyPages: strategy.emptyPages,
    pagesWithText: strategy.pagesWithText,
    fallbackRecommended: strategy.fallbackRecommended,
    fallbackReasons: strategy.fallbackReasons,
    warnings: strategy.warnings,
    groundTruth,
  };
}

async function main(): Promise<void> {
  const { fixturesDir, outDir } = parseArgs(process.argv.slice(2));
  const manifest = await loadManifest(fixturesDir);

  if (manifest.length === 0) {
    console.error(`No PDFs found in ${fixturesDir}. Run "npm run fixtures" first.`);
    process.exitCode = 1;
    return;
  }

  const fixtures: FixtureRow[] = [];

  for (const entry of manifest) {
    const pdfPath = path.join(fixturesDir, entry.file);
    const bytes = new Uint8Array(await readFile(pdfPath));

    let best: ExtractionRun | null = null;
    let bestTotal = Number.POSITIVE_INFINITY;
    const bestStrategyMs = new Map<string, number>();

    for (let attempt = 0; attempt < REPEATS; attempt += 1) {
      const run = await extractPdf(bytes, {
        fileName: entry.file,
        fileSizeBytes: bytes.byteLength,
      });
      if (run.totalElapsedMs < bestTotal) {
        bestTotal = run.totalElapsedMs;
        best = run;
      }
      for (const strategy of run.strategies) {
        const previous = bestStrategyMs.get(strategy.strategy) ?? Number.POSITIVE_INFINITY;
        if (strategy.elapsedMs < previous) bestStrategyMs.set(strategy.strategy, strategy.elapsedMs);
      }
    }
    if (!best) continue;

    let expected: string | null = null;
    if (entry.expectedText) {
      try {
        expected = await readFile(path.join(fixturesDir, entry.expectedText), "utf8");
      } catch {
        expected = null;
      }
    }

    fixtures.push({
      id: entry.id,
      file: entry.file,
      category: entry.category,
      description: entry.description,
      expectation: entry.expectation,
      sizeBytes: bytes.byteLength,
      pageCount: best.pageCount,
      overallStatus: best.status,
      totalMs: round2(bestTotal),
      looksScanned: best.looksScanned,
      error: best.error,
      documentWarnings: best.warnings,
      fallbackRecommended: best.fallbackRecommended,
      fallbackReasons: best.fallbackReasons,
      matchedExpectation: checkExpectation(entry, best),
      strategies: best.strategies.map((strategy) =>
        toStrategyRow(
          strategy,
          bestStrategyMs.get(strategy.strategy) ?? strategy.elapsedMs,
          expected && strategy.printableCharacterCount > 0
            ? compareToGroundTruth(expected, strategy.text)
            : null,
        ),
      ),
    });

    const flag = fixtures[fixtures.length - 1].matchedExpectation ? "ok" : "UNEXPECTED";
    console.log(
      `  ${entry.file.padEnd(30)} ${best.status.padEnd(8)} ${String(round2(bestTotal)).padStart(8)} ms  ${flag}`,
    );
  }

  const output: BenchmarkOutput = {
    generatedAt: new Date().toISOString(),
    library: { name: "pdfjs-dist", version: PDFJS_VERSION },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    settings: {
      repeats: REPEATS,
      lowTextThresholdPerPage: LOW_TEXT_THRESHOLD_PER_PAGE,
      fixturesDir: path.relative(REPO_ROOT, fixturesDir),
    },
    notes: [
      "Latency is the fastest of the repeated runs, measured in Node against the PDF.js legacy build.",
      "Total time covers parsing plus both reconstructions; strategy time covers reconstruction only.",
      "Character count is a volume measure and does not prove correct reading order.",
      "Coverage is order-independent token recall. Order is a longest-common-subsequence ratio; a large gap between the two indicates a reading-order problem.",
      "No result in this file is hand-written. Re-run `npm run benchmark` to regenerate it.",
    ],
    fixtures,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "pdf-benchmark-results.json"),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(outDir, "pdf-benchmark-results.md"),
    renderMarkdown(output),
    "utf8",
  );

  console.log(`\nWrote results to ${path.relative(REPO_ROOT, outDir)}/pdf-benchmark-results.{json,md}`);

  const unexpected = fixtures.filter((f) => !f.matchedExpectation);
  if (unexpected.length > 0) {
    console.warn(
      `\n${unexpected.length} fixture(s) did not behave as expected: ${unexpected.map((f) => f.id).join(", ")}`,
    );
  }
}

function renderMarkdown(output: BenchmarkOutput): string {
  const lines: string[] = [];
  const pct = (value: number | undefined) =>
    value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;

  lines.push("# PDF.js extraction benchmark");
  lines.push("");
  lines.push("<!-- Generated by `npm run benchmark`. Do not edit by hand. -->");
  lines.push("");
  lines.push(`- **Generated:** ${output.generatedAt}`);
  lines.push(`- **Library:** ${output.library.name} ${output.library.version}`);
  lines.push(
    `- **Runtime:** Node ${output.runtime.node} on ${output.runtime.platform}/${output.runtime.arch}`,
  );
  lines.push(`- **Fixtures:** \`${output.settings.fixturesDir}\``);
  lines.push(`- **Repeats per fixture:** ${output.settings.repeats} (fastest reported)`);
  lines.push(
    `- **Low-text heuristic:** fewer than ${output.settings.lowTextThresholdPerPage} printable characters per page`,
  );
  lines.push("");
  for (const note of output.notes) lines.push(`> ${note}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Fixture | Category | Pages | Status | Total | Scanned | Fallback | As expected |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const fixture of output.fixtures) {
    lines.push(
      `| \`${fixture.file}\` | ${fixture.category} | ${fixture.pageCount} | ${fixture.overallStatus} | ` +
        `${fixture.totalMs} ms | ${fixture.looksScanned ? "yes" : "no"} | ` +
        `${fixture.fallbackRecommended ? "recommended" : "not needed"} | ` +
        `${fixture.matchedExpectation ? "yes" : "**no**"} |`,
    );
  }
  lines.push("");

  lines.push("## Per-strategy detail");
  lines.push("");
  for (const fixture of output.fixtures) {
    lines.push(`### \`${fixture.file}\` (${fixture.category})`);
    lines.push("");
    lines.push(fixture.description);
    lines.push("");
    if (fixture.error) {
      lines.push(`**Fatal error:** ${fixture.error}`);
      lines.push("");
    }
    if (fixture.documentWarnings.length > 0) {
      lines.push("**Document warnings:**");
      lines.push("");
      for (const warning of fixture.documentWarnings) lines.push(`- ${warning}`);
      lines.push("");
    }
    if (fixture.fallbackReasons.length > 0) {
      lines.push(`**Fallback reasons:** ${fixture.fallbackReasons.map((r) => `\`${r}\``).join(", ")}`);
      lines.push("");
    }

    lines.push(
      "| Strategy | Status | Reconstruct | Pages w/ text | Empty pages | Printable | Raw | Coverage | Order | Order suspect |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const strategy of fixture.strategies) {
      lines.push(
        `| ${strategy.strategyName} | ${strategy.status} | ${strategy.reconstructionMs} ms | ` +
          `${strategy.pagesWithText}/${strategy.pageCount} | ` +
          `${strategy.emptyPages.length > 0 ? strategy.emptyPages.join(", ") : "none"} | ` +
          `${strategy.printableCharacterCount.toLocaleString("en-US")} | ` +
          `${strategy.characterCount.toLocaleString("en-US")} | ` +
          `${pct(strategy.groundTruth?.tokenCoverage)} | ${pct(strategy.groundTruth?.sequenceSimilarity)} | ` +
          `${strategy.groundTruth ? (strategy.groundTruth.readingOrderSuspect ? "**yes**" : "no") : "n/a"} |`,
      );
    }
    lines.push("");

    const warned = fixture.strategies.filter((s) => s.warnings.length > 0);
    if (warned.length > 0) {
      lines.push("**Strategy warnings:**");
      lines.push("");
      for (const strategy of warned) {
        for (const warning of strategy.warnings) {
          lines.push(`- *${strategy.strategyName}:* ${warning}`);
        }
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exitCode = 1;
});
