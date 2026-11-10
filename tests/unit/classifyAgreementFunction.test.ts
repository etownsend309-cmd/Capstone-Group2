import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  verifyRequestOrigin: vi.fn(),
  parse: vi.fn(),
  constructorOptions: vi.fn(),
}));

vi.mock("@netlify/identity", () => ({
  getUser: mocks.getUser,
  verifyRequestOrigin: mocks.verifyRequestOrigin,
}));

vi.mock("openai", () => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number) {
      super(`OpenAI ${status}`);
      this.status = status;
    }
  }
  class MockOpenAI {
    static APIError = MockApiError;
    responses = { parse: mocks.parse };
    constructor(options: unknown) {
      mocks.constructorOptions(options);
    }
  }
  return { default: MockOpenAI };
});

vi.mock("openai/helpers/zod", () => ({
  zodTextFormat: vi.fn(() => ({ type: "json_schema" })),
}));

import OpenAI from "openai";
import handler, {
  PROVIDER_DEADLINE_MS,
} from "../../netlify/functions/classify-agreement";

const validRequest = () =>
  new Request("https://clausepilot.example/.netlify/functions/classify-agreement", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://clausepilot.example",
    },
    body: JSON.stringify({
      agreementId: "b18fa174-6759-4d6a-99b1-c28e5b960bd5",
      documentText: "This agreement is governed by the laws of Georgia.",
      extraction: { strategy: "coordinate-order", pageCount: 1 },
    }),
  });

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.verifyRequestOrigin.mockReset();
  mocks.parse.mockReset();
  mocks.constructorOptions.mockReset();
  mocks.getUser.mockResolvedValue({ id: "user-1", email: "requester@example.test" });
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.Group2_API_Key;
  process.env.OPENAI_MODEL = "gpt-5.6-terra";
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.Group2_API_Key;
  delete process.env.OPENAI_MODEL;
  vi.restoreAllMocks();
});

describe("classify-agreement Netlify Function", () => {
  it("requires an authenticated Identity user", async () => {
    mocks.getUser.mockResolvedValueOnce(null);
    const response = await handler(validRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request before reading the agreement", async () => {
    mocks.verifyRequestOrigin.mockImplementationOnce(() => {
      throw new Error("origin mismatch");
    });
    const response = await handler(validRequest());
    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("returns only exact-grounded findings with run provenance", async () => {
    mocks.parse.mockResolvedValueOnce({
      id: "resp_123",
      model: "gpt-5.6-terra",
      usage: { input_tokens: 120, output_tokens: 30 },
      output_parsed: {
        findings: [{
          category: "Governing Law",
          quote: "governed by the laws of Georgia",
          leftContext: null,
          rightContext: ".",
          confidenceIndicator: "high",
        }],
      },
    });
    const response = await handler(validRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "complete",
      run: {
        provider: "OpenAI",
        providerResponseId: "resp_123",
        promptVersion: "clausepilot-classifier-v1",
        inputTokens: 120,
      },
      findings: [{
        category: "Governing Law",
        sourceText: "governed by the laws of Georgia",
        sourceStart: 18,
        sourceEnd: 49,
        evidenceValidation: "exact",
      }],
      rejections: [],
    });
    expect(mocks.parse.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.6-terra",
      reasoning: { effort: "low" },
      store: false,
    });
    expect(mocks.constructorOptions).toHaveBeenCalledWith({
      apiKey: "test-key",
      maxRetries: 1,
      timeout: 20_000,
    });
    expect(mocks.parse.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("returns partial output without exposing an unmatched quote as evidence", async () => {
    mocks.parse.mockResolvedValueOnce({
      id: "resp_partial",
      model: "gpt-5.6-terra",
      usage: {},
      output_parsed: {
        findings: [
          {
            category: "Governing Law",
            quote: "governed by the laws of Georgia",
            leftContext: null,
            rightContext: ".",
            confidenceIndicator: "high",
          },
          {
            category: "Insurance",
            quote: "commercial general liability",
            leftContext: null,
            rightContext: null,
            confidenceIndicator: "medium",
          },
        ],
      },
    });
    const response = await handler(validRequest());
    const body = await response.json();
    expect(body.status).toBe("partial");
    expect(body.findings).toHaveLength(1);
    expect(body.rejections).toEqual([
      { category: "Insurance", reason: "unmatched_quote" },
    ]);
  });

  it("uses the existing Netlify secret without returning it to the browser", async () => {
    const netlifySecret = "group2-netlify-secret-value";
    delete process.env.OPENAI_API_KEY;
    process.env.Group2_API_Key = `  ${netlifySecret}  `;
    mocks.parse.mockResolvedValueOnce({
      id: "resp_group2",
      model: "gpt-5.6-terra",
      usage: { input_tokens: 10, output_tokens: 4 },
      output_parsed: {
        findings: [{
          category: "Governing Law",
          quote: "governed by the laws of Georgia",
          leftContext: null,
          rightContext: ".",
          confidenceIndicator: "high",
        }],
      },
    });

    const response = await handler(validRequest());
    const rawBody = await response.text();

    expect(response.status).toBe(200);
    expect(rawBody).not.toContain(netlifySecret);
    expect(JSON.stringify([...response.headers.entries()])).not.toContain(netlifySecret);
    expect(mocks.constructorOptions).toHaveBeenCalledWith({
      apiKey: netlifySecret,
      maxRetries: 1,
      timeout: 20_000,
    });
  });

  it("prefers OPENAI_API_KEY when both credential variables are present", async () => {
    process.env.Group2_API_Key = "group2-netlify-secret-value";
    mocks.parse.mockResolvedValueOnce({
      id: "resp_preferred",
      model: "gpt-5.6-terra",
      usage: {},
      output_parsed: { findings: [] },
    });

    await handler(validRequest());

    expect(mocks.constructorOptions).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "test-key" }),
    );
  });

  it("fails safely when the secret or model output is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.Group2_API_Key;
    let response = await handler(validRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "AI_UNAVAILABLE" },
      run: { status: "manual_required" },
    });

    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.OPENAI_MODEL;
    response = await handler(validRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "AI_UNAVAILABLE" },
      run: { requestedModel: "unconfigured", status: "manual_required" },
    });

    process.env.OPENAI_MODEL = "gpt-5.6-terra";
    mocks.parse.mockResolvedValueOnce({
      id: "resp_refusal",
      model: "gpt-5.6-terra",
      output_parsed: null,
    });
    response = await handler(validRequest());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "AI_REFUSED" },
    });
  });

  it("maps provider rate limiting to a safe retryable error", async () => {
    const RateLimitError = OpenAI.APIError as unknown as new (status: number) => Error;
    mocks.parse.mockRejectedValueOnce(new RateLimitError(429));
    const response = await handler(validRequest());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { code: "AI_RATE_LIMITED" },
    });
  });

  it("aborts at the provider deadline and records a safe timeout run", async () => {
    vi.useFakeTimers();
    try {
      mocks.parse.mockImplementationOnce(
        (_input: unknown, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(new Error("provider request aborted")),
              { once: true },
            );
          }),
      );

      const pendingResponse = handler(validRequest());
      await vi.advanceTimersByTimeAsync(PROVIDER_DEADLINE_MS);
      const response = await pendingResponse;

      expect(response.status).toBe(504);
      expect(await response.json()).toMatchObject({
        error: { code: "AI_TIMEOUT" },
        run: {
          status: "manual_required",
          errorCode: "AI_TIMEOUT",
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
