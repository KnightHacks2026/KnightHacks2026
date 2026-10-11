import { expect, test } from "@playwright/test";

async function openSimulation(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator(".section-tabs").getByRole("button", { name: "Digital Twin" }).click();
  await page.getByRole("group", { name: "Digital Twin mode" }).getByRole("button", { name: "Settlement Simulation" }).click();
  await expect(page.getByRole("region", { name: "Settlement simulation workspace" })).toBeVisible();
}

type PhaseSnapshot = { phase: string | null; statuses: string[]; links: string[]; signalAnimations: string[]; description: string };
async function captureStages(page: import("@playwright/test").Page) {
  await page.locator(".settlement-canvas").evaluate((canvas) => {
    const snapshots: PhaseSnapshot[] = [];
    (window as Window & { settlementStages?: PhaseSnapshot[] }).settlementStages = snapshots;
    new MutationObserver(() => snapshots.push({
      phase: canvas.getAttribute("data-phase"),
      statuses: [...canvas.querySelectorAll(".settlement-node__status")].map(node => node.textContent || ""),
      links: [...canvas.querySelectorAll(".settlement-graph__link")].map(link => link.className),
      signalAnimations: [...canvas.querySelectorAll<HTMLElement>(".settlement-graph__link i")].map(signal => getComputedStyle(signal).animationName),
      description: canvas.querySelector(".settlement-progress strong")?.textContent || "",
    })).observe(canvas, { attributes: true, attributeFilter: ["data-phase"] });
  });
}
async function stages(page: import("@playwright/test").Page) {
  return page.evaluate(() => (window as Window & { settlementStages?: PhaseSnapshot[] }).settlementStages ?? []);
}

test("simulation replaces topology canvas while the original mode remains available", async ({ page }) => {
  await openSimulation(page);
  await expect(page.locator(".network-node")).toHaveCount(0);
  await expect(page.locator(".settlement-node")).toHaveCount(3);
  await expect(page.getByRole("region", { name: "Three connected settlement obligations" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Settlement obligation inspector" })).toContainText("LEG-01");
  await page.getByRole("group", { name: "Digital Twin mode" }).getByRole("button", { name: "Institutional topology" }).click();
  await expect(page.locator(".network-node")).toHaveCount(8);
  await expect(page.locator(".edges path")).toHaveCount(9);
  await expect(page.locator(".inspector")).toContainText("TRANSFER ACTIVITY");
});

test("full funding reveals each projected leg only after its dependency stage", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openSimulation(page);
  const canvas = page.getByRole("region", { name: "Settlement simulation workspace" });
  const inspector = page.getByRole("complementary", { name: "Settlement obligation inspector" });
  await canvas.getByRole("button", { name: "Fund $10M" }).click();
  await expect(canvas.getByRole("button", { name: "Fund $10M" })).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveAttribute("data-phase", "ready");
  await expect(canvas).toContainText("PREVIEW PENDING");
  await expect(inspector).toContainText("90%");
  await captureStages(page);
  await canvas.getByRole("button", { name: "Run Simulation" }).click();
  await expect(canvas.getByRole("button", { name: /Running preview/ })).toBeDisabled();
  await expect(canvas).toHaveAttribute("data-phase", "complete");
  const history = await stages(page);
  expect(history.map(item => item.phase)).toEqual(["root", "leg1", "flow12", "leg2", "flow23", "leg3", "complete"]);
  expect(history.find(item => item.phase === "root")?.statuses).toEqual(["Gap closed · awaiting settlement", "Awaiting upstream", "Awaiting upstream"]);
  expect(history.find(item => item.phase === "leg1")?.statuses).toEqual(["Projected settled", "Awaiting upstream", "Awaiting upstream"]);
  expect(history.find(item => item.phase === "leg2")?.statuses).toEqual(["Projected settled", "Projected settled", "Awaiting upstream"]);
  expect(history.map(item => item.description)).toEqual([
    "Resolving root funding gap", "Projecting LEG-01 settlement", "Propagating proceeds to LEG-02",
    "Projecting LEG-02 settlement", "Propagating proceeds to LEG-03", "Projecting LEG-03 settlement", "Projection complete",
  ]);
  expect(history.find(item => item.phase === "flow12")?.links[0]).toContain("is-propagating");
  expect(history.find(item => item.phase === "flow12")?.links[0]).not.toContain("is-restored");
  expect(history.find(item => item.phase === "flow12")?.signalAnimations[0]).toBe("settlement-travel-link");
  expect(history.find(item => item.phase === "leg2")?.links[0]).toContain("is-restored");
  expect(history.find(item => item.phase === "flow23")?.links[1]).toContain("is-propagating");
  expect(history.find(item => item.phase === "flow23")?.links[1]).not.toContain("is-restored");
  expect(history.find(item => item.phase === "leg3")?.links[1]).toContain("is-restored");
  await expect(inspector).toContainText("100%");
  await expect(canvas).toContainText("FLOW RESTORED");
  await expect(canvas.locator(".settlement-overview__signal")).toContainText("Fund $10M · $0M gap · 3 projected settled · 0 blocked");
  await expect(canvas.locator(".settlement-node__status")).toHaveText(["Projected settled", "Projected settled", "Projected settled"]);
  await canvas.locator(".settlement-node").nth(1).click();
  await expect(inspector).toContainText("LEG-02");
  await expect(inspector).toContainText("LEG-03");
  await expect(canvas).toContainText("not verified simulation engine outputs");
  await canvas.getByRole("button", { name: "Replay Simulation" }).click();
  await expect(canvas).toHaveAttribute("data-phase", "ready");
  await expect(canvas).toContainText("PREVIEW PENDING");
  await expect(canvas).toHaveAttribute("data-phase", "complete");
});

test("partial funding stays amber and all three legs remain blocked", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openSimulation(page);
  const canvas = page.getByRole("region", { name: "Settlement simulation workspace" });
  const inspector = page.getByRole("complementary", { name: "Settlement obligation inspector" });
  await canvas.getByRole("button", { name: "Fund $5M" }).click();
  await expect(canvas).toContainText("PREVIEW PENDING");
  await expect(inspector).toContainText("90%");
  await captureStages(page);
  await canvas.getByRole("button", { name: "Run Simulation" }).click();
  await expect(canvas).toHaveAttribute("data-phase", "complete");
  const history = await stages(page);
  expect(history.map(item => item.phase)).toEqual(["root", "flow12", "leg2", "flow23", "leg3", "complete"]);
  expect(history.find(item => item.phase === "flow12")?.description).toBe("Tracing blocked dependency to LEG-02");
  expect(history.find(item => item.phase === "flow12")?.statuses).toEqual(["Partially funded", "Awaiting upstream", "Awaiting upstream"]);
  expect(history.find(item => item.phase === "flow12")?.links[0]).toContain("is-propagating");
  expect(history.find(item => item.phase === "flow12")?.signalAnimations[0]).toBe("settlement-travel-link");
  expect(history.find(item => item.phase === "leg2")?.links[0]).toContain("is-partial-blocked");
  expect(history.find(item => item.phase === "flow23")?.statuses).toEqual(["Partially funded", "Dependency blocked", "Awaiting upstream"]);
  expect(history.find(item => item.phase === "flow23")?.links[1]).toContain("is-propagating");
  expect(history.find(item => item.phase === "leg3")?.links[1]).toContain("is-partial-blocked");
  expect(history.every(item => item.links.every(link => !link.includes("is-restored")))).toBe(true);
  await expect(inspector).toContainText("95%");
  await expect(canvas.locator(".settlement-node__status")).toHaveText(["Partially funded", "Dependency blocked", "Dependency blocked"]);
  await expect(canvas).toContainText("GAP NARROWED");
  await expect(canvas).toContainText("$5M");
  await expect(canvas.locator(".settlement-overview__signal")).toContainText("Fund $5M · $5M gap · 0 projected settled · 3 blocked");
  await expect(canvas.locator(".settlement-node.is-partial")).toHaveCount(1);
});

test("baseline propagates root blockage to both downstream legs", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openSimulation(page);
  const canvas = page.getByRole("region", { name: "Settlement simulation workspace" });
  await captureStages(page);
  await canvas.getByRole("button", { name: "Run Simulation" }).click();
  await expect(canvas).toHaveAttribute("data-phase", "complete");
  const history = await stages(page);
  expect(history.map(item => item.phase)).toEqual(["root", "flow12", "leg2", "flow23", "leg3", "complete"]);
  expect(history.find(item => item.phase === "root")?.statuses).toEqual(["Liquidity shortfall", "Awaiting upstream", "Awaiting upstream"]);
  expect(history.find(item => item.phase === "leg2")?.statuses).toEqual(["Liquidity shortfall", "Dependency blocked", "Awaiting upstream"]);
  expect(history.find(item => item.phase === "flow12")?.statuses).toEqual(["Liquidity shortfall", "Awaiting upstream", "Awaiting upstream"]);
  expect(history.find(item => item.phase === "flow12")?.links[0]).toContain("is-propagating");
  expect(history.find(item => item.phase === "flow12")?.signalAnimations[0]).toBe("settlement-travel-link");
  expect(history.find(item => item.phase === "flow23")?.statuses).toEqual(["Liquidity shortfall", "Dependency blocked", "Awaiting upstream"]);
  expect(history.find(item => item.phase === "flow23")?.links[1]).toContain("is-propagating");
  expect(history.find(item => item.phase === "leg3")?.links[1]).toContain("is-blocked");
  expect(history.every(item => item.links.every(link => !link.includes("is-restored")))).toBe(true);
  await expect(canvas).toContainText("FLOW INTERRUPTED");
  await expect(canvas).toContainText("$10M");
  await expect(canvas.locator(".settlement-overview__signal")).toContainText("Baseline · $10M gap · 0 projected settled · 3 blocked");
});

test("reduced motion completes the same preview without motion animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openSimulation(page);
  const canvas = page.getByRole("region", { name: "Settlement simulation workspace" });
  await canvas.getByRole("button", { name: "Fund $10M" }).click();
  await canvas.getByRole("button", { name: "Run Simulation" }).click();
  await expect(canvas).toHaveAttribute("data-phase", "complete");
  await expect(canvas.locator(".settlement-node__status")).toHaveText(["Projected settled", "Projected settled", "Projected settled"]);
  const animation = await canvas.locator(".settlement-node").first().evaluate(element => getComputedStyle(element).animationName);
  expect(animation).toBe("none");
  await expect(canvas.locator(".settlement-graph__link.is-restored")).toHaveCount(2);
  await expect(canvas.locator(".settlement-graph__link.is-propagating")).toHaveCount(0);
});

test("replay and scenario switching reset the projection and keep the inspector in sync", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openSimulation(page);
  const canvas = page.getByRole("region", { name: "Settlement simulation workspace" });
  const inspector = page.getByRole("complementary", { name: "Settlement obligation inspector" });
  await canvas.locator(".settlement-node").nth(2).click();
  await canvas.getByRole("button", { name: "Fund $10M" }).click();
  await expect(inspector).toContainText("LEG-03");
  await expect(inspector).toContainText("Scenario preview pending");
  await canvas.getByRole("button", { name: "Run Simulation" }).click();
  await expect(canvas).toHaveAttribute("data-phase", "flow12");
  await expect(canvas.getByRole("button", { name: "Baseline" })).toBeDisabled();
  await expect(inspector).toContainText("Awaiting upstream");
  await expect(canvas).toHaveAttribute("data-phase", "complete");
  await expect(inspector).toContainText("Projected settled");
  await canvas.getByRole("button", { name: "Replay Simulation" }).click();
  await expect(canvas).toHaveAttribute("data-phase", "ready");
  await expect(inspector).toContainText("Awaiting upstream");
  await expect(canvas).toHaveAttribute("data-phase", "complete");
  await canvas.getByRole("button", { name: "Fund $5M" }).click();
  await expect(canvas).toHaveAttribute("data-phase", "ready");
  await expect(canvas.locator(".settlement-graph__link.is-restored")).toHaveCount(0);
  await expect(inspector).toContainText("Scenario preview pending");
  await canvas.getByRole("button", { name: "Run Simulation" }).click();
  await expect(canvas).toHaveAttribute("data-phase", "complete");
  await expect(inspector).toContainText("Dependency blocked");
});

test("desktop workspace fits and mobile simulation has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSimulation(page);
  const canvas = page.getByRole("region", { name: "Settlement simulation workspace" });
  const inspector = page.getByRole("complementary", { name: "Settlement obligation inspector" });
  const canvasBox = await canvas.boundingBox();
  const inspectorBox = await inspector.boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(852);
  expect(inspectorBox!.y + inspectorBox!.height).toBeLessThanOrEqual(852);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  await expect(inspector).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
