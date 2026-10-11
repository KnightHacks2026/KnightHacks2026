import { randomUUID } from "node:crypto";
import { cascadeImport } from "../../src/contracts/fixtures/twin-cascade";
import { expect, test } from "./authenticated-test";

test.describe.configure({ mode: "serial" });

const openPortfolios = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.locator(".section-tabs").getByRole("button", { name: "Portfolios", exact: true }).click();
};

async function donutPoint(page: import("@playwright/test").Page, fraction: number) {
  const box = await page.getByRole("group", { name: "Portfolio asset allocation" }).boundingBox();
  if (!box) throw new Error("Allocation chart is not visible.");
  const angle = (-90 + fraction * 360) * Math.PI / 180;
  const radius = box.width * 44 / 120;
  return { x: box.x + box.width / 2 + Math.cos(angle) * radius,
    y: box.y + box.height / 2 + Math.sin(angle) * radius };
}

test("all inventory tabs select and show only supported inventory", async ({ page }) => {
  await openPortfolios(page);
  const tabs = page.getByRole("tablist", { name: "Inventory views" });
  await expect(tabs.getByRole("tab", { name: "Consolidated" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".asset-row")).toHaveCount(5);
  for (const [name, message] of [["Cold Storage", "No verified cold storage inventory"], ["Treasury", "No verified treasury inventory"], ["Client Omnibus", "No omnibus account inventory"]] as const) {
    await tabs.getByRole("tab", { name }).click();
    await expect(tabs.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: message })).toBeVisible();
    await expect(page.locator(".asset-row")).toHaveCount(0);
    await expect(page.locator(".donut-segment")).toHaveCount(0);
  }
  await tabs.getByRole("tab", { name: "Consolidated" }).click();
  await expect(page.locator(".asset-row")).toHaveCount(5);
  await expect(page.locator(".donut-segment")).toHaveCount(5);
});

test("unverified inventory states explain their source coverage at desktop and mobile widths", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openPortfolios(page);
    for (const [name, title, source] of [
      ["Cold Storage", "No verified cold storage inventory", "custody location and treasury ownership are unavailable"],
      ["Treasury", "No verified treasury inventory", "custody location and treasury ownership are unavailable"],
      ["Client Omnibus", "No omnibus account inventory", "Imported datasets checked:"],
    ] as const) {
      await page.getByRole("tab", { name }).click();
      const status = page.getByRole("status", { name: `${name} inventory status` });
      await expect(status.getByRole("heading", { name: title })).toBeVisible();
      await expect(status.locator(".portfolio-empty__source")).toContainText(source);
      await expect(status.getByRole("button")).toHaveCount(0);
      const bounds = await status.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect(bounds!.height).toBeGreaterThanOrEqual(290);
    }
  }
});

test("omnibus tab reads imported account balances without inventing market values", async ({ page }) => {
  const datasetId = `portfolio-${randomUUID()}`;
  const payload = structuredClone(cascadeImport);
  payload.dataset.id = datasetId;
  payload.dataset.name = "Portfolio omnibus verification";
  for (const key of ["institutions", "accounts", "instruments", "sourceRecords", "obligations", "dependencies"] as const) {
    for (const item of payload[key]) item.datasetId = datasetId;
  }
  const imported = await page.request.post("/api/datasets/import", { data: payload });
  expect(imported.status()).toBe(201);
  await openPortfolios(page);
  await page.getByRole("tab", { name: "Client Omnibus" }).click();
  const inventory = page.getByRole("region", { name: "Client omnibus account inventory" });
  await expect(inventory).toContainText("Origin");
  await expect(inventory).toContainText("USD 90000000 settled");
  await expect(inventory).toContainText("25 DEMO settled");
  await expect(inventory).toContainText("USD ALLOCATION");
  await expect(inventory).toContainText("Unavailable");
  await expect(page.locator(".donut-segment")).toHaveCount(0);
});

test("donut hover, focus, and keyboard selection reveal matching numerical detail", async ({ page }) => {
  await openPortfolios(page);
  const bitcoin = page.getByRole("button", { name: "Bitcoin (BTC) allocation" });
  const btcPoint = await donutPoint(page, .2);
  await page.mouse.move(btcPoint.x, btcPoint.y);
  const detail = page.locator(".allocation-detail");
  await expect(detail).toContainText("Bitcoin · BTC");
  await expect(detail).toContainText("34.1% allocation · $2.87B USD value");
  await expect(detail).toContainText("42,318.82 BTC held");
  const bounds = await Promise.all([detail.boundingBox(), page.locator(".allocation-donut").boundingBox()]);
  expect(bounds[0]!.x).toBeGreaterThanOrEqual(bounds[1]!.x);
  expect(bounds[0]!.x + bounds[0]!.width).toBeLessThanOrEqual(bounds[1]!.x + bounds[1]!.width + 1);
  const ethereum = page.getByRole("button", { name: "Ethereum (ETH) allocation" });
  await ethereum.focus();
  await expect(detail).toContainText("27.2% allocation · $2.29B USD value");
  await ethereum.press("Enter");
  await expect(ethereum).toHaveAttribute("aria-pressed", "true");
  await ethereum.blur();
  await expect(detail).toContainText("656,104.18 ETH held");
});

test.describe("touch allocation", () => {
  test.use({ hasTouch: true });
  test("tapping a segment reveals allocation values on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPortfolios(page);
    const usdcPoint = await donutPoint(page, .82);
    await page.touchscreen.tap(usdcPoint.x, usdcPoint.y);
    await expect(page.locator(".allocation-detail")).toContainText("11.9% allocation · $998.4M USD value");
    await expect(page.getByRole("tablist", { name: "Inventory views" }).getByRole("tab", { name: "Treasury" })).toBeVisible();
  });
});
