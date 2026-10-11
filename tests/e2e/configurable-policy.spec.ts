import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./authenticated-test";

test("asset threshold policies persist, toggle evaluation, archive, and restore", async ({ page }) => {
  const name = `BTC threshold ${randomUUID()}`;
  const created = await page.request.post("/api/policies", {
    data: { userId: "demo-user", name, asset: "BTC", threshold: "4" },
  });
  expect(created.status()).toBe(201);
  const createdBody = await created.json();
  expect(createdBody.data.policy).toMatchObject({ name, asset: "BTC", threshold: "4", state: "Enforced" });

  const database = new DatabaseSync(process.env.CUSTODYOS_DATABASE_PATH!);
  try {
    expect(database.prepare(`SELECT state FROM example_policies WHERE user_id = ? AND name = ?`)
      .get("demo-user", name)).toEqual({ state: "Enforced" });
    expect(database.prepare(`SELECT asset, threshold, action FROM example_policy_rules WHERE user_id = ? AND policy_name = ?`)
      .get("demo-user", name)).toEqual({ asset: "BTC", threshold: "4", action: "human_approval" });
    expect(database.prepare(`SELECT action FROM example_policy_audit WHERE user_id = ? AND policy_name = ? ORDER BY occurred_at DESC LIMIT 1`)
      .get("demo-user", name)).toEqual({ action: "created" });
  } finally {
    database.close();
  }

  const transfer = await page.request.post("/api/transfer", {
    data: { contractVersion: "1.0.0", userId: "demo-user", assetType: "BTC", assetAmount: "5", assetSource: "BTC", senderName: "Demo Treasury" },
  });
  expect(transfer.status()).toBe(201);
  const transferBody = await transfer.json();
  const transactionId = transferBody.data.transaction.id as string;
  const reviews = async () => {
    const response = await page.request.get("/api/transfer/reviews");
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const hasPolicyMatch = (body: { data: { transfers: Array<{ id: string; evaluation: { checks: Array<{ id: string; result: string }> } }> } }) =>
    body.data.transfers.find(row => row.id === transactionId)?.evaluation.checks.find(check => check.id === `custom:${name}`);
  expect((await reviews()).data.transfers.find((row: { id: string }) => row.id === transactionId)
    .evaluation.checks.find((check: { id: string }) => check.id === `custom:${name}`).result).toBe("Approval required");

  await page.goto("/");
  await page.locator(".section-tabs").getByRole("button", { name: "Policy Engine", exact: true }).click();
  await page.locator(".policy-list > button").filter({ hasText: name }).click();
  await page.getByRole("button", { name: "Disable", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable", exact: true })).toBeVisible();
  expect(hasPolicyMatch(await reviews())).toBeUndefined();

  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(page.getByRole("button", { name: "Disable", exact: true })).toBeVisible();
  expect(hasPolicyMatch(await reviews())?.result).toBe("Approval required");

  await page.locator(".policy-canvas-head").getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("button", { name: "Archive policy", exact: true }).click();
  await page.getByRole("tab", { name: /Archived/ }).click();
  await page.locator(".policy-list > button").filter({ hasText: name }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  expect(hasPolicyMatch(await reviews())?.result).toBe("Approval required");
});
