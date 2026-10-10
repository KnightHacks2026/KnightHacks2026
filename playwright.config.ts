import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    ...devices["Desktop Chrome"],
    channel: process.platform === "win32" ? "chrome" : undefined,
  },
  webServer: {
    command: "node tests/e2e/server.mjs",
    url: "http://127.0.0.1:3100",
    env: { CUSTODYOS_DATABASE_PATH: "data/e2e.sqlite" },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
