import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { analyzeAgreement } from "../../src/lib/analyze.js";
import { configuredOpenAiApiKey } from "../../src/shared/openaiCredentials.js";
import {
  APPROVED_CATEGORIES,
  MODEL_CONFIG_VERSION,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  type ApprovedCategory,
} from "../../src/shared/classifier.js";
import { classifierInstructions } from "../../netlify/functions/_shared/classifierPrompt.js";
import { modelClassifierOutputSchema } from "../../netlify/functions/_shared/classifierSchema.js";
import { validateSourceQuotes } from "../../netlify/functions/_shared/validateSourceQuotes.js";
import {
  summarizeEvaluation,
  type EvaluationCase,
} from "./metrics.js";

const manifestSchema = z.object({
  source: z.string().min(1),
  selectionSeed: z.string().min(1).optional(),
  categories: z.array(z.enum(APPROVED_CATEGORIES)),
  contracts: z.array(
    z.object({
      pdfFile: z.string().min(1),
      txtFile: z.string().min(1),
      positiveCategories: z.array(z.enum(APPROVED_CATEGORIES)),
    }),
  ),
});

type Manifest = z.infer<typeof manifestSchema>;

type Engine = "local-rule" | "openai";

interface Args {
  engine: Engine;
  datasetRoot: string;
  manifest: string;
  outDir: string;
  holdout: boolean;
  frozenConfig: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    engine: "local-rule",
    datasetRoot: path.join(process.env.HOME ?? "", "Desktop", "CUAD_v1"),
    manifest: path.resolve("experiments/pdf-comparison/manifests/cuad-30.json"),
    outDir: path.resolve("artifacts"),
    holdout: false,
    frozenConfig: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--engine" && (value === "local-rule" || value === "openai")) {
      args.engine = value;
    }
    if (argv[index] === "--dataset-root" && value) args.datasetRoot = path.resolve(value);
    if (argv[index] === "--manifest" && value) args.manifest = path.resolve(value);
    if (argv[index] === "--out-dir" && value) args.outDir = path.resolve(value);
    if (argv[index] === "--holdout") args.holdout = true;
    if (argv[index] === "--frozen-config") args.frozenConfig = true;
  }
  return args;
}

async function resolveTextDirectory(datasetRoot: string): Promise<string> {
  const expected = path.join(datasetRoot, "full_contract_txt");
  return stat(expected)
    .then((details) => (details.isDirectory() ? expected : datasetRoot))
    .catch(() => datasetRoot);
}

async function evaluateLocalRule(
  id: string,
  text: string,
  expected: ApprovedCategory[],
): Promise<EvaluationCase> {
  const started = performance.now();
  const approved = new Set<string>(APPROVED_CATEGORIES);
  const predicted = analyzeAgreement(text)
    .filter((finding) => approved.has(finding.category))
    .map((finding) => ({ category: finding.category as ApprovedCategory }));
  return {
    id,
    expected,
    predicted,
    acceptedEvidence: predicted.length,
    rejectedEvidence: 0,
    latencyMs: Math.round(performance.now() - started),
  };
}

async function evaluateOpenAi(
  client: OpenAI,
  model: string,
  id: string,
  text: string,
  expected: ApprovedCategory[],
): Promise<EvaluationCase> {
  const started = performance.now();
  try {
    const response = await client.responses.parse({
      model,
      reasoning: { effort: "low" },
      max_output_tokens: 4_000,
      store: false,
      input: [
        { role: "system", content: classifierInstructions },
        {
          role: "user",
          content: `Classify the agreement between the CONTRACT_TEXT markers.\n\nCONTRACT_TEXT\n${text}\nEND_CONTRACT_TEXT`,
        },
      ],
      text: { format: zodTextFormat(modelClassifierOutputSchema, SCHEMA_VERSION) },
    });
    if (!response.output_parsed) throw new Error("The model returned no parsed output.");
    const grounded = validateSourceQuotes(text, response.output_parsed.findings);
    return {
      id,
      expected,
      predicted: grounded.findings.map((finding) => ({
        category: finding.category,
        confidenceIndicator: finding.confidenceIndicator,
      })),
      acceptedEvidence: grounded.findings.length,
      rejectedEvidence: grounded.rejections.length,
      latencyMs: Math.round(performance.now() - started),
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    };
  } catch {
    return {
      id,
      expected,
      predicted: [],
      acceptedEvidence: 0,
      rejectedEvidence: 0,
      latencyMs: Math.round(performance.now() - started),
      failed: true,
    };
  }
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

function markdownReport(output: ReturnType<typeof buildOutput>): string {
  const lines = [
    "# AI classifier evaluation",
    "",
    `- **Dataset:** ${output.dataset.source}`,
    `- **Documents:** ${output.summary.documents}`,
    `- **Engine:** ${output.configuration.engine}`,
    `- **Model:** ${output.configuration.model ?? "n/a"}`,
    `- **Prompt/schema:** ${output.configuration.promptVersion} / ${output.configuration.schemaVersion}`,
    `- **Failures:** ${output.summary.failures}`,
    "- **Privacy:** No agreement text or source quotes are included in this report.",
    "",
    "## Aggregate",
    "",
    `- Macro precision: ${percent(output.summary.macroPrecision)}`,
    `- Macro recall: ${percent(output.summary.macroRecall)}`,
    `- Macro F1: ${percent(output.summary.macroF1)}`,
    `- Exact-evidence acceptance: ${percent(output.summary.exactEvidenceAcceptanceRate)}`,
    `- Input/output tokens: ${output.summary.totalInputTokens} / ${output.summary.totalOutputTokens}`,
    "",
    "## Per-category results",
    "",
    "| Category | TP | FP | FN | Precision | Recall | F1 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...output.summary.perCategory.map((item) =>
      `| ${item.category} | ${item.truePositives} | ${item.falsePositives} | ${item.falseNegatives} | ${percent(item.precision)} | ${percent(item.recall)} | ${percent(item.f1)} |`,
    ),
    "",
    "## Limitations",
    "",
    "- Category positives come from the prepared manifest derived from CUAD master_clauses.csv.",
    "- CUAD is the development/evaluation set; do not treat these results as independent holdout evidence.",
    "- The separate 10-agreement modified holdout must remain sealed until configuration is frozen.",
  ];
  return `${lines.join("\n")}\n`;
}

function buildOutput(
  args: Args,
  manifest: Manifest,
  cases: EvaluationCase[],
  model?: string,
) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataset: {
      source: manifest.source,
      selectionSeed: manifest.selectionSeed,
      holdout: args.holdout,
    },
    configuration: {
      engine: args.engine,
      model,
      reasoningEffort: args.engine === "openai" ? "low" : undefined,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      modelConfigVersion: MODEL_CONFIG_VERSION,
      frozenConfig: args.frozenConfig,
    },
    summary: summarizeEvaluation(APPROVED_CATEGORIES, cases),
    cases,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = manifestSchema.parse(JSON.parse(await readFile(args.manifest, "utf8")));
  if (args.holdout && (manifest.contracts.length !== 10 || !args.frozenConfig)) {
    throw new Error(
      "Holdout evaluation requires exactly 10 agreements and --frozen-config. Do not use holdouts for tuning.",
    );
  }
  const textDirectory = await resolveTextDirectory(args.datasetRoot);
  const model = process.env.OPENAI_MODEL?.trim();
  const apiKey = configuredOpenAiApiKey();
  if (args.engine === "openai" && (!apiKey || !model)) {
    throw new Error(
      "Set OPENAI_API_KEY or the Netlify variable Group2_API_Key, plus an explicitly approved OPENAI_MODEL, before OpenAI evaluation.",
    );
  }
  const client = args.engine === "openai" ? new OpenAI({ apiKey }) : undefined;
  const cases: EvaluationCase[] = [];
  for (const contract of manifest.contracts) {
    const text = await readFile(path.join(textDirectory, contract.txtFile), "utf8");
    const result = client
      ? await evaluateOpenAi(client, model!, contract.pdfFile, text, contract.positiveCategories)
      : await evaluateLocalRule(contract.pdfFile, text, contract.positiveCategories);
    cases.push(result);
    process.stdout.write(`Evaluated ${cases.length}/${manifest.contracts.length}: ${contract.pdfFile}\n`);
  }

  const output = buildOutput(args, manifest, cases, client ? model : undefined);
  const stem = args.holdout
    ? "ai-classifier-holdout"
    : args.engine === "openai"
      ? "ai-classifier-evaluation"
      : "ai-classifier-baseline";
  await mkdir(args.outDir, { recursive: true });
  await writeFile(path.join(args.outDir, `${stem}.json`), `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(path.join(args.outDir, `${stem}.md`), markdownReport(output));
  process.stdout.write(`Wrote sanitized ${stem} reports to ${args.outDir}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
