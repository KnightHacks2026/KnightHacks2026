import { createHash } from "node:crypto";
import { expect, test as base } from "@playwright/test";
import { Secret, TOTP } from "otpauth";

/** Establish a real password/TOTP session before dashboard tests. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const password = process.env.CUSTODYOS_E2E_PASSWORD;
    const otpSecret = process.env.CUSTODYOS_E2E_OTP_SECRET;
    if (!password || !otpSecret) throw new Error("Playwright credentials were not provisioned.");
    const response = await page.request.post("/api/users/login", {
      data: {
        username: "demo-user",
        password: createHash("sha256").update(password).digest("hex"),
        otpCode: new TOTP({ secret: Secret.fromBase32(otpSecret) }).generate(),
      },
    });
    if (!response.ok()) throw new Error(`Playwright login failed with HTTP ${response.status()}.`);
    if (!response.headers()["set-cookie"]?.includes("custodyos_session=")) throw new Error("Login did not issue a server session.");
    await page.addInitScript(() => sessionStorage.setItem("userid", "demo-user"));
    await use(page);
  },
});

export { expect };
