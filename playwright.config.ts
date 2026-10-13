import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 45000,
  globalTimeout: 30 * 60 * 1000,
  forbidOnly: !!process.env.CI,
  workers: 1,
  use: {
    channel: "msedge",
    baseURL: process.env.AURE_BROWSER_BASE_URL || "http://127.0.0.1:1420",
    viewport: { width: 1440, height: 960 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
