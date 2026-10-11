import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { Secret, TOTP } from "otpauth";

const userId = `browser-login-${randomUUID()}`;
const password = `browser-password-${randomUUID()}`;
const otpSecret = "JBSWY3DPEHPK3PXP";
const databasePath = process.env.CUSTODYOS_DATABASE_PATH ?? "data/e2e.sqlite";

test.beforeAll(() => {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    database.prepare("INSERT INTO custody_authenticate (user_id, password, otp_secret) VALUES (?, ?, ?)")
      .run(userId, createHash("sha256").update(password).digest("hex"), otpSecret);
  } finally {
    database.close();
  }
});

test.afterAll(() => {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'custody_sessions'").get()) {
      database.prepare("DELETE FROM custody_sessions WHERE user_id = ?").run(userId);
    }
    database.prepare("DELETE FROM custody_authenticate WHERE user_id = ?").run(userId);
  } finally {
    database.close();
  }
});

test("valid login survives refresh and opens dashboard tabs", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "WORK EMAIL" }).fill(userId);
  await page.getByLabel("PASSWORD", { exact: true }).fill(password);
  await page.getByRole("textbox", { name: "ONE TIME PASSWORD" })
    .fill(new TOTP({ secret: Secret.fromBase32(otpSecret) }).generate());
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("userid"))).toBe(userId);

  await page.reload();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Digital Twin" }).click();
  await expect(page.getByRole("group", { name: "Digital Twin mode" })).toBeVisible();
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Transactions" }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("invalid credentials show an actionable error", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "WORK EMAIL" }).fill(userId);
  await page.getByLabel("PASSWORD", { exact: true }).fill("wrong-password");
  await page.getByRole("textbox", { name: "ONE TIME PASSWORD" }).fill("123456");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Check your username and password" })).toBeVisible();
  await expect(page).toHaveURL("/login");
  expect(await page.evaluate(() => sessionStorage.getItem("userid"))).toBeNull();
});
