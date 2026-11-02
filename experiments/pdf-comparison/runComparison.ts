import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { extractPdf, PDFJS_VERSION } from "../../src/pdf/extractPdf.js";
import type { StrategyResult } from "../../src/pdf/types.js";
import { compareExtraction, type ComparisonMetrics } from "./metrics.js";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");

interface ManifestContract {
  pdfFile: string;
  txtFile: string;
  contractType: string;
  lengthChars: number;
  positiveCategories: string[];
}

interface Manifest {
  schemaVersion: number;
  selectionSeed: string;
  source: string;
  categories: string[];
  contracts: ManifestContract[];
}

interface RawPythonEngine {
  engineId: string;
  engineName: string;
  version: string;
  status: "success" | "warning" | "failed";
  elapsedMs: number;
  pageCount: number;
  pages: string[];
  warnings: string[];
  error: string | null;
}

interface PythonOutput {
  runtime: { pymupdf: string; pdfplumber: string };
  contracts: Array<{
    pdfFile: string;
    sourcePath: string | null;
    engines: RawPythonEngine[];
    error: string | null;
  }>;
}

interface EngineResult {
  engineId: string;
  engineName: string;
  version: string;
  status: "success" | "warning" | "failed";
  elapsedMs: number;
  pageCount: number;
  printableCharacterCount: number;
  emptyPages: number[];
  warnings: string[];
  error: string | null;
  metrics: ComparisonMetrics;
}

interface ContractResult {
  pdfFile: string;
  contractType: string;
  positiveCategories: string[];
  sizeBytes: number;
  engines: EngineResult[];
}

interface EngineSummary {
  engineId: string;
  engineName: string;
  version: string;
  documents: number;
  successes: number;
  warnings: number;
  failures: number;
  medianLatencyMs: number;
  meanPrecision: number;
  meanRecall: number;
  meanF1: number;
  meanSequenceSimilarity: number;
}

interface Args {
  datasetRoot: string;
  manifest: string;
  outDir: string;
  python: string;
}

function parseArgs(argv: string[]): Args {
  const defaults: Args = {
    datasetRoot: path.join(process.env.HOME ?? "", "Desktop", "CUAD_v1"),
    manifest: path.join(HERE, "manifests", "cuad-30.json"),
    outDir: path.join(REPO_ROOT, "artifacts"),
    python: "python3",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--dataset-root" && value) defaults.datasetRoot = path.resolve(value);
    if (argv[index] === "--manifest" && value) defaults.manifest = path.resolve(value);
    if (argv[index] === "--out-dir" && value) defaults.outDir = path.resolve(value);
    if (argv[index] === "--python" && value) defaults.python = value;
  }
  return defaults;
}

function normalizedStem(filename: string): string {
  return path.basename(filename, path.extname(filename)).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function findPdfs(directory: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.name.toLowerCase().endsWith(".pdf")) {
        const key = normalizedStem(entry.name);
        if (!result.has(key)) result.set(key, fullPath);
      }
    }
  }
  await visit(directory);
  return result;
}

function textMetrics(pages: string[]): {
  text: string;
  printableCharacterCount: number;
  emptyPages: number[];
} {
  const text = pages.join("\n\n");
  return {
    text,
    printableCharacterCount: text.replace(/\s/gu, "").length,
    emptyPages: pages.flatMap((page, index) => (page.trim() ? [] : [index + 1])),
  };
}

function strategyResult(
  strategy: StrategyResult,
  totalMs: number,
  expected: string,
): EngineResult {
  return {
    engineId: `pdfjs-${strategy.strategy}`,
    engineName: strategy.strategyName,
    version: PDFJS_VERSION,
    status: strategy.status,
    elapsedMs: totalMs,
    pageCount: strategy.pageCount,
    printableCharacterCount: strategy.printableCharacterCount,
    emptyPages: strategy.emptyPages,
    warnings: strategy.warnings,
    error: null,
    metrics: compareExtraction(expected, strategy.text),
  };
}

function pythonResult(engine: RawPythonEngine, expected: string): EngineResult {
  const measured = textMetrics(engine.pages);
  return {
    engineId: engine.engineId,
    engineName: engine.engineName,
    version: engine.version,
    status: engine.status,
    elapsedMs: engine.elapsedMs,
    pageCount: engine.pageCount,
    printableCharacterCount: measured.printableCharacterCount,
    emptyPages: measured.emptyPages,
    warnings: engine.warnings,
    error: engine.error,
    metrics: compareExtraction(expected, measured.text),
  };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function summarize(contracts: ContractResult[]): EngineSummary[] {
  const grouped = new Map<string, EngineResult[]>();
  for (const result of contracts.flatMap((contract) => contract.engines)) {
    grouped.set(result.engineId, [...(grouped.get(result.engineId) ?? []), result]);
  }
  return [...grouped.entries()].map(([engineId, results]) => ({
    engineId,
    engineName: results[0].engineName,
    version: results[0].version,
    documents: results.length,
    successes: results.filter((result) => result.status === "success").length,
    warnings: results.filter((result) => result.status === "warning").length,
    failures: results.filter((result) => result.status === "failed").length,
    medianLatencyMs: round(median(results.map((result) => result.elapsedMs)), 2),
    meanPrecision: round(mean(results.map((result) => result.metrics.tokenPrecision))),
    meanRecall: round(mean(results.map((result) => result.metrics.tokenRecall))),
    meanF1: round(mean(results.map((result) => result.metrics.tokenF1))),
    meanSequenceSimilarity: round(
      mean(results.map((result) => result.metrics.sequenceSimilarity)),
    ),
  }));
}

function renderMarkdown(output: {
  generatedAt: string;
  sample: { source: string; size: number; seed: string };
  summaries: EngineSummary[];
  contracts: ContractResult[];
}): string {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    "# PDF engine comparison",
    "",
    "<!-- Generated by experiments/pdf-comparison/runComparison.ts. -->",
    "",
    `- **Generated:** ${output.generatedAt}`,
    `- **Sample:** ${output.sample.size} ${output.sample.source} contracts`,
    `- **Selection seed:** \`${output.sample.seed}\``,
    "- **Reference:** CUAD-provided TXT conversion; it is a useful common reference, not perfect PDF ground truth.",
    "- **Privacy:** This report contains metrics and filenames, never extracted contract text.",
    "",
    "## Aggregate results",
    "",
    "| Engine | Version | Success | Warning | Failed | Median latency | Precision | Recall | F1 | Reading order |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of output.summaries) {
    lines.push(
      `| ${row.engineName} | ${row.version} | ${row.successes} | ${row.warnings} | ` +
        `${row.failures} | ${row.medianLatencyMs} ms | ${percent(row.meanPrecision)} | ` +
        `${percent(row.meanRecall)} | ${percent(row.meanF1)} | ` +
        `${percent(row.meanSequenceSimilarity)} |`,
    );
  }
  lines.push("", "## Per-contract results", "");
  for (const contract of output.contracts) {
    lines.push(`### \`${contract.pdfFile}\``, "");
    lines.push(
      "| Engine | Status | Pages | Empty | Printable | Latency | F1 | Reading order |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const engine of contract.engines) {
      lines.push(
        `| ${engine.engineName} | ${engine.status} | ${engine.pageCount} | ` +
          `${engine.emptyPages.length} | ${engine.printableCharacterCount} | ` +
          `${engine.elapsedMs} ms | ${percent(engine.metrics.tokenF1)} | ` +
          `${percent(engine.metrics.sequenceSimilarity)} |`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(args.manifest, "utf8")) as Manifest;
  const expectedPdfDirectory = path.join(args.datasetRoot, "full_contract_pdf");
  const pdfDirectory = await stat(expectedPdfDirectory)
    .then((details) => (details.isDirectory() ? expectedPdfDirectory : args.datasetRoot))
    .catch(() => args.datasetRoot);
  const pdfs = await findPdfs(pdfDirectory);
  const missing = manifest.contracts.filter(
    (contract) => !pdfs.has(normalizedStem(contract.pdfFile)),
  );
  if (missing.length) {
    throw new Error(
      `Missing ${missing.length} selected PDF(s) under ${pdfDirectory}. ` +
        "Run prepare_dataset.py before the comparison.",
    );
  }

  const localDir = path.join(HERE, ".local");
  const pythonOutputPath = path.join(localDir, "python-results.json");
  await mkdir(localDir, { recursive: true });
  const { stdout, stderr } = await execFileAsync(
    args.python,
    [
      path.join(HERE, "extractors.py"),
      "--dataset-root",
      args.datasetRoot,
      "--manifest",
      args.manifest,
      "--output",
      pythonOutputPath,
    ],
    {
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONPATH: [path.join(HERE, ".local", "python"), process.env.PYTHONPATH]
          .filter(Boolean)
          .join(path.delimiter),
      },
    },
  );
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  const pythonOutput = JSON.parse(await readFile(pythonOutputPath, "utf8")) as PythonOutput;
  const pythonByFile = new Map(
    pythonOutput.contracts.map((contract) => [normalizedStem(contract.pdfFile), contract]),
  );
  const expectedTxtDirectory = path.join(args.datasetRoot, "full_contract_txt");
  const txtDirectory = await stat(expectedTxtDirectory)
    .then((details) => (details.isDirectory() ? expectedTxtDirectory : args.datasetRoot))
    .catch(() => args.datasetRoot);

  const contracts: ContractResult[] = [];
  for (const contract of manifest.contracts) {
    const pdfPath = pdfs.get(normalizedStem(contract.pdfFile));
    if (!pdfPath) continue;
    const expected = await readFile(path.join(txtDirectory, contract.txtFile), "utf8");
    const bytes = new Uint8Array(await readFile(pdfPath));
    const pdfjs = await extractPdf(bytes, {
      fileName: contract.pdfFile,
      fileSizeBytes: bytes.byteLength,
    });
    const python = pythonByFile.get(normalizedStem(contract.pdfFile));
    const engines = [
      ...pdfjs.strategies.map((strategy) =>
        strategyResult(strategy, pdfjs.totalElapsedMs, expected),
      ),
      ...(python?.engines ?? []).map((engine) => pythonResult(engine, expected)),
    ];
    contracts.push({
      pdfFile: contract.pdfFile,
      contractType: contract.contractType,
      positiveCategories: contract.positiveCategories,
      sizeBytes: (await stat(pdfPath)).size,
      engines,
    });
    console.log(`  Compared: ${contract.pdfFile}`);
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sample: {
      source: manifest.source,
      size: contracts.length,
      seed: manifest.selectionSeed,
      categories: manifest.categories,
    },
    runtimes: {
      node: process.version,
      pdfjs: PDFJS_VERSION,
      pymupdf: pythonOutput.runtime.pymupdf,
      pdfplumber: pythonOutput.runtime.pdfplumber,
    },
    caveats: [
      "CUAD TXT files were themselves converted from the PDFs and are not exact layout ground truth.",
      "Latency is a single local run and should be treated as directional.",
      "Full extracted text is retained only in the ignored .local intermediate.",
    ],
    summaries: summarize(contracts),
    contracts,
  };
  await mkdir(args.outDir, { recursive: true });
  await writeFile(
    path.join(args.outDir, "pdf-engine-comparison.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
  await writeFile(
    path.join(args.outDir, "pdf-engine-comparison.md"),
    renderMarkdown(output),
  );
  console.log(`Wrote sanitized results to ${path.relative(REPO_ROOT, args.outDir)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
