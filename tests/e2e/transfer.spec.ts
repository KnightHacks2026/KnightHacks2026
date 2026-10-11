import { expect, test } from "./authenticated-test";

const tab = (page: import("@playwright/test").Page) => page.locator(".section-tabs").getByRole("button", { name: "Transactions", exact: true });

test("New transfer records one pending request and keeps it after refresh", async ({ page }) => {
  const destination = `E2E Custody Test ${Date.now()}`;
  let postCount = 0;
  await page.route("**/api/transfer", async route => {
    postCount += 1;
    await new Promise(resolve => setTimeout(resolve, 350));
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New transfer" });
  await expect(dialog.getByLabel("Source asset")).toBeEnabled();
  await dialog.getByLabel("Source asset").selectOption("BTC");
  await dialog.getByLabel("Amount").fill("1.25");
  await dialog.getByLabel("Destination").fill(destination);
  const submit = dialog.getByRole("button", { name: "Submit request" });
  await submit.click();
  await expect(dialog.getByRole("button", { name: "Submitting…" })).toBeDisabled();
  await dialog.locator("form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await expect(page.getByRole("status").filter({ hasText: "recorded" })).toBeVisible();
  expect(postCount).toBe(1);
  const row = page.locator(".tx-row").filter({ hasText: destination });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Pending approval");
  await expect(row).toContainText(`BTC → ${destination}`);
  await page.reload();
  await tab(page).click();
  await expect(page.locator(".tx-row").filter({ hasText: destination })).toHaveCount(1);
  await expect(page.locator(".tx-row").first()).toContainText("Pending approval");
});

test("invalid input and API errors keep the transfer form open", async ({ page }) => {
  let postCount = 0;
  await page.route("**/api/transfer", route => {
    postCount += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { message: "Transfer service unavailable." } }) });
  });
  await page.goto("/");
  await tab(page).click();
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New transfer" });
  await expect(dialog.getByLabel("Source asset")).toBeEnabled();
  await dialog.getByLabel("Amount").fill("0");
  await dialog.getByLabel("Destination").fill("E2E Error Test");
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Choose a source asset");
  await dialog.getByLabel("Source asset").selectOption("ETH");
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expect(dialog.getByRole("alert")).toContainText("amount greater than zero");
  expect(postCount).toBe(0);
  await dialog.getByLabel("Amount").fill("2.5");
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Transfer service unavailable.");
  expect(postCount).toBe(1);
  await expect(dialog.getByRole("button", { name: "Submit request" })).toBeEnabled();
  await expect(page.locator(".tx-row").filter({ hasText: "E2E Error Test" })).toHaveCount(0);
});

test("transfer dialog fits mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New transfer" });
  await expect(dialog.getByLabel("Source asset")).toBeEnabled();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(dialog.getByRole("button", { name: "Submit request" })).toBeVisible();
});
