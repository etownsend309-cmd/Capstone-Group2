/**
 * Resolves the server-only OpenAI credential.
 *
 * `OPENAI_API_KEY` is the conventional name. `Group2_API_Key` is the variable
 * already stored in Netlify. A blank value is ignored, and neither value may
 * be logged or returned to the browser.
 */
export function configuredOpenAiApiKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  for (const name of ["OPENAI_API_KEY", "Group2_API_Key"]) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}
