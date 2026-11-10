/**
 * One live OpenAI classification call through the same server code the preview uses.
 *
 *   OPENAI_MODEL=gpt-5.6-terra node --import tsx/esm scripts/openaiSmokeTest.ts
 *
 * Reads OPENAI_API_KEY, or Group2_API_Key when the first is blank. Prints status
 * and token counts only. Does not print the key.
 */

import OpenAI from "openai";

import { ClassificationError, runClassification } from "../netlify/functions/_shared/runClassification.ts";

function safeText(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]+/g, "sk-[redacted]").slice(0, 300);
}

const sample =
  "Governing Law. This Agreement is governed by the laws of the State of Georgia.";

try {
  const result = await runClassification(sample);
  console.log(JSON.stringify({
    status: result.status,
    requestedModel: result.run.requestedModel,
    returnedModel: result.run.returnedModel,
    inputTokens: result.run.inputTokens,
    outputTokens: result.run.outputTokens,
    latencyMs: result.run.latencyMs,
    findings: result.findings.length,
    rejections: result.rejections.length,
    providerResponseId: result.run.providerResponseId,
  }, null, 2));
} catch (error) {
  if (error instanceof ClassificationError) {
    const cause = error.cause;
    console.log(JSON.stringify({
      status: error.run.status,
      code: error.code,
      httpStatus: error.status,
      message: error.message,
      requestedModel: error.run.requestedModel,
      providerStatus: cause instanceof OpenAI.APIError ? cause.status : undefined,
      providerCode: cause instanceof OpenAI.APIError ? cause.code : undefined,
      providerMessage: cause instanceof Error ? safeText(cause.message) : undefined,
    }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      status: "failed",
      code: "UNEXPECTED",
      message: error instanceof Error ? error.name : "unknown",
    }, null, 2));
    process.exitCode = 1;
  }
}
