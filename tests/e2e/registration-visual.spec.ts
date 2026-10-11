import { expect, test } from "@playwright/test";

test("registration shows the visual MFA flow without calling registration APIs", async ({ page }) => {
  const registrationRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/users\/register(?:\/verify)?(?:\?|$)/.test(request.url())) {
      registrationRequests.push(request.url());
    }
  });

  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();

  await expect(page.getByRole("heading", { name: /Welcome to CustodyOS!/ })).toBeVisible();
  await page.getByLabel("WORK EMAIL").fill("ops@institution.test");
  await page.getByLabel("PASSWORD").fill("sample-password");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Register MFA" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Sample authenticator QR code/ })).toBeVisible();
  await page.getByRole("button", { name: "Show manual code" }).click();
  await expect(page.getByText(/Manual setup is unavailable/)).toBeVisible();

  await page.getByLabel("ONE TIME PASSWORD").fill("123-456");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("status")).toContainText("No account was created.");
  expect(registrationRequests).toEqual([]);
});
