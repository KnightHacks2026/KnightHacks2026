import { expect, test } from "./authenticated-test";

test("Figma Make opens Overview on arrival and refresh while preserving six screens", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Operational Overview", level: 1 })).toBeVisible();
  await expect(page.locator(".section-tabs button.active")).toHaveText("Overview");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Operational Overview", level: 1 })).toBeVisible();
  await expect(page.locator(".section-tabs button.active")).toHaveText("Overview");

  const screens = [
    ["Digital Twin", "Institutional Asset Topology"],
    ["Overview", "Operational Overview"],
    ["Portfolios", "Asset Inventory"],
    ["Transactions", "Transaction Monitor"],
    ["Policy Engine", "Programmable Governance"],
    ["Reporting", "Evidence & Reporting"],
  ] as const;
  for (const [tab, heading] of screens) {
    await page.locator(".section-tabs").getByRole("button", { name: tab, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.locator(".section-tabs button.active")).toHaveText(tab);
  }
});

test("both CustodyOS logos return every dashboard tab to Overview without ending the session", async ({ page }) => {
  await page.goto("/");
  const tabs = ["Overview", "Digital Twin", "Portfolios", "Transactions", "Policy Engine", "Reporting"];
  for (const logo of [".brand-mark", ".wordmark"]) {
    for (const tab of tabs) {
      await page.locator(".section-tabs").getByRole("button", { name: tab, exact: true }).click();
      await page.locator(logo).click();
      await expect(page.getByRole("heading", { name: "Operational Overview", level: 1 })).toBeVisible();
      await expect(page.locator(".section-tabs button.active")).toHaveText("Overview");
      expect(new URL(page.url()).pathname).toBe("/");
      expect(await page.evaluate(() => sessionStorage.getItem("userid"))).toBe("demo-user");
    }
  }
  await page.locator(".section-tabs").getByRole("button", { name: "Digital Twin" }).click();
  const wordmark = page.locator(".wordmark");
  await page.keyboard.press("Tab");
  await wordmark.focus();
  await expect(wordmark).toBeFocused();
  await expect(wordmark).toHaveCSS("outline-style", "solid");
  await wordmark.press("Enter");
  await expect(page.getByRole("heading", { name: "Operational Overview", level: 1 })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".section-tabs").getByRole("button", { name: "Portfolios" }).click();
  await wordmark.focus();
  await wordmark.press("Space");
  await expect(page.getByRole("heading", { name: "Operational Overview", level: 1 })).toBeVisible();
});

test("Assets Under Custody final bar aligns with 10 OCT", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    const alignment = await page.locator(".exposure-panel").evaluate((panel) => {
      const chart = panel.querySelector(".chart");
      const bars = panel.querySelectorAll(".chart i");
      const label = panel.querySelector(".chart-axis span:last-child");
      if (!chart || bars.length !== 24 || !label) throw new Error("Custody chart is incomplete");
      return {
        chartRight: chart.getBoundingClientRect().right,
        barRight: bars[23].getBoundingClientRect().right,
        labelRight: label.getBoundingClientRect().right,
        firstHeight: bars[0].getBoundingClientRect().height,
        finalHeight: bars[23].getBoundingClientRect().height,
      };
    });
    expect(Math.abs(alignment.barRight - alignment.chartRight)).toBeLessThanOrEqual(1);
    expect(Math.abs(alignment.barRight - alignment.labelRight)).toBeLessThanOrEqual(1);
    expect(alignment.firstHeight).toBe(38);
    expect(alignment.finalHeight).toBe(132);
  }
});
