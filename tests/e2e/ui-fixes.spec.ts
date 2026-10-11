import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "./authenticated-test";


test("all five attention rows stay above Live Operations at responsive widths", async ({ page }) => {
  for (const width of [390, 900, 1440, 1698, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Operational Overview" })).toBeVisible();
    const bounds = await page.locator(".overview-grid").evaluate(grid => {
      const ledger = grid.querySelector(".action-ledger")!;
      const operations = grid.querySelector(".operations-stream")!;
      const rows = ledger.querySelectorAll(".action-row");
      for (let i = rows.length; i < 5; i++) {
        const clone = rows[rows.length - 1].cloneNode(true) as HTMLElement;
        clone.querySelector("strong")!.textContent = `Rebalance · Screening ${i + 1}`;
        ledger.append(clone);
      }
      const last = ledger.querySelector(".action-row:last-child")!.getBoundingClientRect();
      return { lastBottom: last.bottom, ledgerBottom: ledger.getBoundingClientRect().bottom, operationsTop: operations.getBoundingClientRect().top };
    });
    expect(bounds.lastBottom).toBeLessThanOrEqual(bounds.ledgerBottom + 1);
    expect(bounds.ledgerBottom).toBeLessThanOrEqual(bounds.operationsTop + 1);
  }
});

test("topology export contains current nodes, edges, labels, and selection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Digital Twin" }).click();
  await page.locator(".network-node").filter({ hasText: "BTC VAULT" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export view" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("custodyos-topology.svg");
  const svg = await readFile(await download.path(), "utf8");
  expect(svg.length).toBeGreaterThan(3000);
  expect(svg).toContain("BTC VAULT");
  expect(svg).toContain("selected");
  expect(svg).toContain("<path");
  await expect(page.getByRole("status").filter({ hasText: "Topology SVG downloaded" })).toBeVisible();
});

test("console navigation, inspection selection, and settlement mode work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Digital Twin" }).click();
  await page.getByRole("button", { name: "Open console" }).click();
  const consolePanel = page.getByRole("dialog", { name: "Operational console" });
  await expect(consolePanel).toBeVisible();
  await expect(consolePanel.getByText("PERSISTED REQUESTS")).toBeVisible();
  await consolePanel.getByRole("tab", { name: "Policy evaluations" }).click();
  await expect(consolePanel.getByText("Only persisted transfer requests")).toBeVisible();
  await consolePanel.getByRole("button", { name: "Close" }).click();
  await expect(consolePanel).toBeHidden();
  await page.locator(".network-node").filter({ hasText: "ETH VAULT" }).click();
  await page.getByRole("button", { name: "Inspect entity" }).click();
  const inspection = page.getByRole("dialog", { name: "Entity inspection" });
  await expect(inspection.getByRole("heading", { name: "ETH VAULT" })).toBeVisible();
  await expect(inspection.getByText("No verified wallet association")).toBeVisible();
  await inspection.getByRole("button", { name: /ACME BANK/ }).click();
  await expect(inspection.getByRole("heading", { name: "ACME BANK" })).toBeVisible();
  await inspection.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Open console" }).click();
  await page.getByRole("dialog", { name: "Operational console" }).getByRole("button", { name: "Open Settlement Simulation" }).click();
  await expect(page.getByRole("heading", { name: "Settlement Simulation", level: 1 })).toBeVisible();
});

test("policy form validates, persists a draft, and retains samples", async ({ page }) => {
  const name = `Test draft ${randomUUID()}`;
  const databasePath = process.env.CUSTODYOS_DATABASE_PATH ?? "data/e2e.sqlite";
  try {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Policy Engine" }).click();
    await expect(page.locator(".policy-list")).toContainText("Institutional Withdrawal");
    await page.getByRole("button", { name: "Create draft", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create policy" });
    await dialog.getByRole("button", { name: "Save draft policy" }).click();
    await expect(dialog.getByRole("alert")).toContainText("at least 3 characters");
    await dialog.getByRole("textbox", { name: "Policy name" }).fill(name);
    await dialog.getByRole("textbox", { name: "Scope description" }).fill("Treasury wallet requests");
    await dialog.getByRole("textbox", { name: "Rule description" }).fill("Human review required for this proposed control");
    await dialog.getByRole("button", { name: "Save draft policy" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".policy-list")).toContainText(name);
    await expect(page.locator(".policy-draft-detail")).toContainText("not evaluated by transfer review");
    await page.reload();
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: "Policy Engine" }).click();
    await expect(page.locator(".policy-list")).toContainText(name);
    await expect(page.locator(".policy-list")).toContainText("Institutional Withdrawal");
  } finally {
    const database = new DatabaseSync(databasePath);
    try { database.prepare("DELETE FROM example_policies WHERE user_id = ? AND name = ?").run("demo-user", name); }
    finally { database.close(); }
  }
});
