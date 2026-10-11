import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./authenticated-test";

test("authenticated dashboard demo flows from topology through review, simulation, policy, and reporting", async ({ page }) => {
  const nav = (name: string) => page.locator(".section-tabs").getByRole("button", { name, exact: true });
  const draftName = `Workflow draft ${randomUUID()}`;
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Operational Overview" })).toBeVisible();
    await nav("Digital Twin").click();
    await page.locator(".network-node").filter({ hasText: "BTC VAULT" }).click();
    await page.getByLabel("Synthetic activity feed").getByRole("button", { name: /Transfer submitted/ }).click();
    await page.getByRole("button", { name: "Inspect entity" }).click();
    await expect(page.getByRole("dialog", { name: "Entity inspection" })).toContainText("BTC VAULT");
    await page.getByRole("dialog", { name: "Entity inspection" }).getByRole("button", { name: "Close" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export view" }).click();
    expect((await downloadPromise).suggestedFilename()).toBe("custodyos-topology.svg");
    await page.getByRole("button", { name: "Open console" }).click();
    await expect(page.getByRole("dialog", { name: "Operational console" })).toBeVisible();
    await page.getByRole("dialog", { name: "Operational console" }).getByRole("button", { name: "Close" }).click();
    await nav("Transactions").click();
    await page.getByRole("button", { name: "New transfer" }).click();
    const transfer = page.getByRole("dialog", { name: "New transfer" });
    await transfer.getByLabel("Source asset").selectOption("BTC");
    await transfer.getByLabel("Amount").fill("1.25");
    await transfer.getByLabel("Destination").fill("Demo Treasury");
    await transfer.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByRole("status").filter({ hasText: "recorded" })).toBeVisible();
    const transferId = await page.locator(".tx-row").filter({ hasText: "Demo Treasury" }).first().locator("small").first().innerText();
    await nav("Policy Engine").click();
    const review = page.getByRole("region", { name: "Local demo transfer review" });
    await review.locator(".policy-review-list button").filter({ hasText: transferId }).click();
    await review.getByRole("button", { name: "Approve for processing" }).click();
    await expect(review.getByRole("status")).toContainText(/approved for processing/i);
    await nav("Digital Twin").click();
    await page.locator(".twin-transfer-list button").filter({ hasText: transferId }).click();
    await expect(page.getByLabel("Selected transfer details")).toContainText("Approved for processing");
    await page.getByRole("group", { name: "Digital Twin mode" }).getByRole("button", { name: "Settlement Simulation" }).click();
    const canvas = page.getByRole("region", { name: "Settlement simulation workspace" });
    await canvas.getByRole("button", { name: "Fund $10M" }).click();
    await canvas.getByRole("button", { name: "Run Simulation" }).click();
    await expect(canvas).toHaveAttribute("data-phase", "complete");
    await nav("Policy Engine").click();
    await page.getByRole("button", { name: "Create policy" }).click();
    const policy = page.getByRole("dialog", { name: "Create policy" });
    await policy.getByRole("textbox", { name: "Policy name" }).fill(draftName);
    await policy.getByRole("textbox", { name: "Scope description" }).fill("Demo treasury requests");
    await policy.getByRole("textbox", { name: "Rule description" }).fill("Human review before processing");
    await policy.getByRole("button", { name: "Save draft policy" }).click();
    await expect(page.locator(".policy-list")).toContainText(draftName);
    await nav("Reporting").click();
    await expect(page.getByRole("heading", { name: "Evidence & Reporting" })).toBeVisible();
  } finally {
    const database = new DatabaseSync(process.env.CUSTODYOS_DATABASE_PATH!);
    try { database.prepare("DELETE FROM example_policies WHERE user_id = ? AND name = ?").run("demo-user", draftName); }
    finally { database.close(); }
  }
});
