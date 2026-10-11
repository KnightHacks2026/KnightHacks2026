import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import QRCode from "qrcode";
import { Secret, TOTP } from "otpauth";

test("registration creates a pending account and verifies its authenticator code", async ({ page }) => {
  const username = `ops-${randomUUID()}@institution.test`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();

  await expect(page.getByRole("heading", { name: /Welcome to CustodyOS!/ })).toBeVisible();
  await page.getByLabel("WORK EMAIL").fill(username);
  await page.getByLabel("PASSWORD").fill("sample-password");

  const registerResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/users/register") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  const registerResponse = await registerResponsePromise;
  expect(registerResponse.status()).toBe(201);

  const registration = (await registerResponse.json()).data as {
    registrationId: string;
    otpSecret: string;
    expiresAt: string;
  };
  await expect(page.getByRole("heading", { name: "Register MFA" })).toBeVisible();

  const otpAuthUri = `otpauth://totp/CustodyOS:${encodeURIComponent(username)}?secret=${encodeURIComponent(registration.otpSecret)}&issuer=CustodyOS`;
  const expectedQrCode = await QRCode.toDataURL(otpAuthUri, { width: 251, margin: 1 });
  await expect(page.getByRole("img", { name: `Authenticator QR code for ${username}` })).toHaveAttribute("src", expectedQrCode);

  await page.getByRole("button", { name: "Show manual code" }).click();
  await expect(page.getByText(registration.otpSecret, { exact: true })).toBeVisible();

  const otpCode = new TOTP({ secret: Secret.fromBase32(registration.otpSecret) }).generate();
  const verifyResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/users/register/verify") && response.request().method() === "POST",
  );
  await page.getByLabel("ONE TIME PASSWORD").fill(otpCode);
  await page.getByRole("button", { name: "Submit" }).click();
  const verifyResponse = await verifyResponsePromise;
  expect(verifyResponse.status()).toBe(200);
  expect((await verifyResponse.json()).data).toEqual({ userId: username });
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("userid"))).toBe(username);
});
