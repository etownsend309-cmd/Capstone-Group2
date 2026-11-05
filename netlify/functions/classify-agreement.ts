import { getUser, verifyRequestOrigin } from "@netlify/identity";

import type { ClassifierApiError, ClassifierErrorCode } from "../../src/shared/classifier.js";
import { classifyAgreementRequestSchema } from "./_shared/classifierSchema.js";
import { ClassificationError, PROVIDER_DEADLINE_MS, runClassification } from "./_shared/runClassification.js";

export { PROVIDER_DEADLINE_MS };

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
  run?: ClassifierApiError["run"],
): Response {
  const body: ClassifierApiError = { error: { code, message }, ...(run ? { run } : {}) };
  return json(body, status);
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

  try {
    return json(await runClassification(parsedRequest.data.documentText));
  } catch (error) {
    if (error instanceof ClassificationError) {
      return errorResponse(error.code, error.message, error.status, error.run);
    }
    return errorResponse("INTERNAL_ERROR", "AI classification failed. Continue with manual review.", 500);
  }
}
