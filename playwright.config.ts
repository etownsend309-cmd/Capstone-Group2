import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright drives the temporary evaluation UI against the generated fixtures.
 *
 * Two browser projects are defined. Chromium is the team default; Firefox
 * exists so the suite can run on machines where the Chromium download is
 * unavailable. Select one with `--project=firefox`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    // The upload flows need a real file chooser, so keep downloads contained.
    acceptDownloads: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    // Uses the Google Chrome already installed on the machine instead of
    // Playwright's bundled Chromium. Useful where `npx playwright install`
    // cannot reach the Playwright CDN.
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
