import { describe, expect, it } from "vitest";

import { configuredOpenAiApiKey } from "../../src/shared/openaiCredentials";

describe("configuredOpenAiApiKey", () => {
  it("prefers the conventional variable and trims it", () => {
    expect(configuredOpenAiApiKey({
      OPENAI_API_KEY: "  conventional-key  ",
      Group2_API_Key: "netlify-key",
    })).toBe("conventional-key");
  });

  it("uses the existing Netlify variable when the conventional one is absent or blank", () => {
    expect(configuredOpenAiApiKey({
      OPENAI_API_KEY: "   ",
      Group2_API_Key: " netlify-key ",
    })).toBe("netlify-key");
  });

  it("returns undefined when neither variable contains a key", () => {
    expect(configuredOpenAiApiKey({})).toBeUndefined();
  });
});
