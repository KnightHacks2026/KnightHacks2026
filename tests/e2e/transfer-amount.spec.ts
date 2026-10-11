import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./authenticated-test";

test("formatted amount submits exactly and persists after refresh", async ({ page }) => {
  const destination = `Amount formatting ${Date.now()}`;
  let submittedAmount = "";
  await page.route("**/api/transfer", async route => {
    submittedAmount = JSON.parse(route.request().postData() ?? "{}").assetAmount;
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New transfer" });
  await dialog.getByLabel("Source asset").selectOption("BTC");
  const amount = dialog.getByLabel("Amount");
  await amount.fill("2000000000");
  await expect(amount).toHaveValue("2,000,000,000");
  await amount.fill("2,000,000,000");
  await expect(amount).toHaveValue("2,000,000,000");
  await dialog.getByLabel("Destination").fill(destination);
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("status").filter({ hasText: "recorded" })).toBeVisible();
  expect(submittedAmount).toBe("2000000000");
  const row = page.locator(".tx-row").filter({ hasText: destination });
  await expect(row.locator("span").nth(2)).toHaveText("BTC 2,000,000,000");

  const db = new DatabaseSync(process.env.CUSTODYOS_DATABASE_PATH!);
  try {
    const stored = db.prepare("SELECT amount, status FROM example_transactions WHERE route = ?")
      .get(`BTC → ${destination}`) as { amount: string; status: string } | undefined;
    expect(stored).toEqual({ amount: "2000000000 BTC", status: "Pending approval" });
  } finally {
    db.close();
  }

  await page.reload();
  await page.locator(".section-tabs").getByRole("button", { name: "Transactions", exact: true }).click();
  await expect(page.locator(".tx-row").filter({ hasText: destination }).locator("span").nth(2)).toHaveText("BTC 2,000,000,000");
});

test("seeded ledger amounts keep the Figma asset order on desktop and mobile", async ({ page }) => {
  await page.goto("/");
  await page.locator(".section-tabs").getByRole("button", { name: "Transactions", exact: true }).click();
  const btc = page.locator(".tx-row").filter({ hasText: "TX-7E29A1" }).locator("span").nth(2);
  const usdc = page.locator(".tx-row").filter({ hasText: "TX-9B14C8" }).locator("span").nth(2);
  const eth = page.locator(".tx-row").filter({ hasText: "TX-3A82F4" }).locator("span").nth(2);
  await expect(btc).toHaveText("BTC 128.42");
  await expect(usdc).toHaveText("USDC 24,800,000");
  await expect(eth).toHaveText("ETH 4,806.15");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(usdc).toHaveText("USDC 24,800,000");
  await expect(usdc).toBeVisible();
});

test("decimal transfer keeps every digit in the mobile ledger after refresh", async ({ page }) => {
  const destination = `Decimal display ${Date.now()}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New transfer" });
  await dialog.getByLabel("Source asset").selectOption("ETH");
  await dialog.getByLabel("Amount").fill("1234567.123456789012345678");
  await dialog.getByLabel("Destination").fill(destination);
  await dialog.getByRole("button", { name: "Submit request" }).click();
  const amount = page.locator(".tx-row").filter({ hasText: destination }).locator("span").nth(2);
  await expect(amount).toHaveText("ETH 1,234,567.123456789012345678");
  await page.reload();
  await page.locator(".section-tabs").getByRole("button", { name: "Transactions", exact: true }).click();
  await expect(page.locator(".tx-row").filter({ hasText: destination }).locator("span").nth(2))
    .toHaveText("ETH 1,234,567.123456789012345678");
});

test("editing around separators keeps the intended digits", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  const amount = page.getByRole("dialog", { name: "New transfer" }).getByLabel("Amount");
  await amount.pressSequentially("1000");
  await expect(amount).toHaveValue("1,000");
  await amount.evaluate((input: HTMLInputElement) => input.setSelectionRange(2, 2));
  await amount.press("Backspace");
  await expect(amount).toHaveValue("000");
  await amount.fill("1000");
  await amount.evaluate((input: HTMLInputElement) => input.setSelectionRange(1, 1));
  await amount.press("Delete");
  await expect(amount).toHaveValue("100");
});

test("invalid grouping is rejected without submitting", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/transfer", route => { posts += 1; return route.continue(); });
  await page.goto("/");
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New transfer" });
  await dialog.getByLabel("Source asset").selectOption("BTC");
  await dialog.getByLabel("Destination").fill("Invalid grouping");
  await dialog.getByLabel("Amount").fill("1,2");
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expect(dialog.getByRole("alert")).toContainText("amount greater than zero");
  expect(posts).toBe(0);
});

test("mobile amount input formats while typing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  const amount = page.getByRole("dialog", { name: "New transfer" }).getByLabel("Amount");
  await amount.pressSequentially("1234567.89");
  await expect(amount).toHaveValue("1,234,567.89");
  await expect(amount).toBeInViewport();
});
