import { expect, test } from "./authenticated-test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator(".section-tabs").getByRole("button", { name: "Digital Twin", exact: true }).click();
});

test("synthetic event controls synchronize signal, nodes, feed, and inspector without mutations", async ({ page }) => {
  const mutations: string[] = [];
  page.on("request", request => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) mutations.push(`${request.method()} ${request.url()}`);
  });
  const graph = page.getByRole("img", { name: "Interactive digital asset custody network" });
  await expect(graph.locator(".network-node")).toHaveCount(8);
  await expect(graph.locator(".edges path")).toHaveCount(9);
  const feed = page.getByLabel("Synthetic activity feed");
  await expect(feed.getByRole("button")).toHaveCount(6);

  for (const [type, state, source, destination] of [
    ["Transfer submitted", "submitted", "BTC VAULT", "FIREBLOCKS"],
    ["Transfer approved", "approved", "ACME BANK", "SETTLEMENT"],
    ["Transfer rejected", "rejected", "ETH VAULT", "FIREBLOCKS"],
    ["Transfer settled", "settled", "ACME BANK", "SETTLEMENT"],
    ["Policy flagged", "flagged", "BTC VAULT", "POLICY 01"],
    ["Simulation completed", "simulation", "ACME BANK", "SETTLEMENT"],
  ] as const) {
    await feed.getByRole("button", { name: new RegExp(type) }).click();
    await expect(graph.locator(`.topology-activity-signal.is-${state}`)).toBeVisible();
    await expect(graph.locator(".network-node.activity-associated")).toHaveCount(2);
    await expect(graph.locator(".network-node.activity-associated").filter({ hasText: source })).toBeVisible();
    await expect(graph.locator(".network-node.activity-associated").filter({ hasText: destination })).toBeVisible();
    const detail = page.getByLabel("Selected operational event");
    await expect(detail).toContainText(type);
    await expect(detail).toContainText(source);
    await expect(detail).toContainText(destination);
    await expect(graph.locator(".edges path")).toHaveCount(9);
  }

  await expect(page.getByLabel("Selected operational event")).toContainText("Hypothetical projection only");
  await expect(page.getByLabel("Selected operational event")).toContainText("No operational action taken");
  expect(mutations).toEqual([]);
});

test("approval and settlement differ; node selection restores entity inspection", async ({ page }) => {
  const feed = page.getByLabel("Synthetic activity feed");
  await feed.getByRole("button", { name: /Transfer approved/ }).click();
  await expect(page.getByLabel("Selected operational event")).toContainText("Authorized, not executed");
  await expect(page.getByLabel("Selected operational event")).toContainText("Execution and settlement pending");
  await feed.getByRole("button", { name: /Transfer settled/ }).click();
  await expect(page.getByLabel("Selected operational event")).toContainText("Execution and settlement confirmed");
  await page.locator(".network-node").filter({ hasText: "BTC VAULT" }).click();
  await expect(page.getByLabel("Selected operational event")).toHaveCount(0);
  await expect(page.locator(".inspector h2")).toHaveText("BTC VAULT");
});

test("reduced motion pauses signals, and simulation mode round trip preserves topology", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByLabel("Synthetic activity feed").getByRole("button", { name: /Policy flagged/ }).click();
  await expect(page.getByLabel("Selected operational event")).toContainText("Illustrative signer threshold exception");
  const pulse = page.locator(".topology-activity-signal__pulse");
  await expect(pulse).toHaveCSS("animation-name", "none");
  await page.getByRole("group", { name: "Digital Twin mode" }).getByRole("button", { name: "Settlement Simulation" }).click();
  await expect(page.getByRole("heading", { name: "Settlement Simulation" })).toBeVisible();
  await page.getByRole("group", { name: "Digital Twin mode" }).getByRole("button", { name: "Institutional topology" }).click();
  await expect(page.locator(".network-node")).toHaveCount(8);
  await expect(page.locator(".edges path")).toHaveCount(9);
  await expect(page.getByLabel("Selected operational event")).toContainText("Policy flagged");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByLabel("Synthetic activity feed")).toBeVisible();
    const bounds = await page.locator(".inspector").boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  }
});
