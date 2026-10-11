import { defineConfig, devices } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Secret } from "otpauth";

process.env.CUSTODYOS_E2E_DATABASE_PATH ??= join(tmpdir(), `custodyos-e2e-${randomUUID()}.sqlite`);
process.env.CUSTODYOS_DATABASE_PATH = process.env.CUSTODYOS_E2E_DATABASE_PATH;
process.env.CUSTODYOS_E2E_PASSWORD ??= randomBytes(24).toString("base64url");
process.env.CUSTODYOS_E2E_OTP_SECRET ??= Secret.fromHex(randomBytes(20).toString("hex")).base32;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  workers: 4,
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    ...devices["Desktop Chrome"],
    channel: process.platform === "win32" ? "chrome" : undefined,
  },
  webServer: {
    command: "node tests/e2e/server.mjs",
    url: "http://127.0.0.1:3100",
    env: {
      CUSTODYOS_DATABASE_PATH: process.env.CUSTODYOS_DATABASE_PATH,
      CUSTODYOS_E2E_PASSWORD: process.env.CUSTODYOS_E2E_PASSWORD,
      CUSTODYOS_E2E_OTP_SECRET: process.env.CUSTODYOS_E2E_OTP_SECRET,
    },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
