import { getUser, verifyRequestOrigin } from "@netlify/identity";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  MODEL_CONFIG_VERSION,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  type ClassificationRun,
  type ClassifierApiError,
  type ClassifierErrorCode,
  type ClassifyAgreementResult,
} from "../../src/shared/classifier.js";
import { configuredOpenAiApiKey } from "../../src/shared/openaiCredentials.js";
import { classifierInstructions } from "./_shared/classifierPrompt.js";
import {
  classifyAgreementRequestSchema,
  modelClassifierOutputSchema,
} from "./_shared/classifierSchema.js";
import { validateSourceQuotes } from "./_shared/validateSourceQuotes.js";

const MAX_OUTPUT_TOKENS = 4_000;
export const PROVIDER_DEADLINE_MS = 25_000;
const PROVIDER_REQUEST_TIMEOUT_MS = 20_000;
const PROVIDER_MAX_RETRIES = 1;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function errorResponse(
  code: ClassifierErrorCode,
  message: string,
  status: number,
  run?: ClassificationRun,
): Response {
  const body: ClassifierApiError = { error: { code, message }, ...(run ? { run } : {}) };
  return json(body, status);
}

function failedRun(
  startedAt: string,
  started: number,
  requestedModel: string,
  code: ClassifierErrorCode,
): ClassificationRun {
  return {
    id: crypto.randomUUID(),
    provider: "OpenAI",
    requestedModel,
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    modelConfigVersion: MODEL_CONFIG_VERSION,
    startedAt,
    completedAt: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - started),
    status: "manual_required",
    errorCode: code,
  };
}

function mapOpenAiError(error: unknown, deadlineExpired: boolean): {
  code: ClassifierErrorCode;
  status: number;
  message: string;
} {
  if (deadlineExpired) {
    return {
      code: "AI_TIMEOUT",
      status: 504,
      message: "AI classification exceeded its time limit. Continue with manual review or retry later.",
    };
  }
  if (error instanceof OpenAI.APIError) {
    if (error.status === 429) {
      return {
        code: "AI_RATE_LIMITED",
        status: 429,
        message: "AI classification is temporarily rate limited. Continue with manual review or retry later.",
      };
    }
    if (error.status === 400 || error.status === 422) {
      return {
        code: "AI_INVALID_RESPONSE",
        status: 502,
        message: "The AI service could not produce a valid classification. Continue with manual review.",
      };
    }
  }
  return {
    code: "AI_UNAVAILABLE",
    status: 503,
    message: "AI classification is unavailable. The agreement can still be reviewed manually.",
  };
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse("INVALID_REQUEST", "Only POST is supported.", 405);
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return errorResponse("INVALID_REQUEST", "Content-Type must be application/json.", 415);
  }
  try {
    verifyRequestOrigin(request);
  } catch {
    return errorResponse("FORBIDDEN", "The request origin is not allowed.", 403);
  }

  const user = await getUser();
  if (!user) {
    return errorResponse("UNAUTHENTICATED", "Sign in before classifying an agreement.", 401);
  }

  let unknownBody: unknown;
  try {
    unknownBody = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "The request body is not valid JSON.", 400);
  }
  const parsedRequest = classifyAgreementRequestSchema.safeParse(unknownBody);
  if (!parsedRequest.success) {
    return errorResponse("INVALID_REQUEST", "The classification request is invalid.", 400);
  }

  const configuredModel = process.env.OPENAI_MODEL?.trim();
  const requestedModel = configuredModel || "unconfigured";
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const apiKey = configuredOpenAiApiKey();
  if (!apiKey || !configuredModel) {
    const code = "AI_UNAVAILABLE";
    return errorResponse(
      code,
      "AI classification credentials or model selection are not configured. The agreement can still be reviewed manually.",
      503,
      failedRun(startedAt, started, requestedModel, code),
    );
  }

  const providerController = new AbortController();
  let deadlineExpired = false;
  const deadline = setTimeout(() => {
    deadlineExpired = true;
    providerController.abort();
  }, PROVIDER_DEADLINE_MS);
  deadline.unref?.();

  try {
    const client = new OpenAI({
      apiKey,
      maxRetries: PROVIDER_MAX_RETRIES,
      timeout: PROVIDER_REQUEST_TIMEOUT_MS,
    });
    const response = await client.responses.parse({
      model: requestedModel,
      reasoning: { effort: "low" },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false,
      input: [
        { role: "system", content: classifierInstructions },
        {
          role: "user",
          content:
            "Classify the agreement between the CONTRACT_TEXT markers.\n\n" +
            `CONTRACT_TEXT\n${parsedRequest.data.documentText}\nEND_CONTRACT_TEXT`,
        },
      ],
      text: {
        format: zodTextFormat(modelClassifierOutputSchema, SCHEMA_VERSION),
      },
    }, { signal: providerController.signal });

    if (!response.output_parsed) {
      const code = "AI_REFUSED";
      return errorResponse(
        code,
        "The AI service did not return a classification. Continue with manual review.",
        502,
        {
          ...failedRun(startedAt, started, requestedModel, code),
          returnedModel: response.model,
          providerResponseId: response.id,
        },
      );
    }

    const grounded = validateSourceQuotes(
      parsedRequest.data.documentText,
      response.output_parsed.findings,
    );
    const status =
      grounded.rejections.length === 0
        ? "complete"
        : grounded.findings.length > 0
          ? "partial"
          : "manual_required";
    const run: ClassificationRun = {
      id: crypto.randomUUID(),
      provider: "OpenAI",
      requestedModel,
      returnedModel: response.model,
      providerResponseId: response.id,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      modelConfigVersion: MODEL_CONFIG_VERSION,
      startedAt,
      completedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      status,
    };
    const result: ClassifyAgreementResult = {
      status,
      run,
      findings: grounded.findings,
      rejections: grounded.rejections,
    };
    return json(result);
  } catch (error) {
    const mapped = mapOpenAiError(error, deadlineExpired);
    return errorResponse(
      mapped.code,
      mapped.message,
      mapped.status,
      failedRun(startedAt, started, requestedModel, mapped.code),
    );
  } finally {
    clearTimeout(deadline);
  }
}
