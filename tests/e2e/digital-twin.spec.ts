import { expect, test, type Page } from "@playwright/test";

const tab = (page: Page, name: string) => page.locator(".section-tabs").getByRole("button", { name, exact: true });

async function createTransfer(page: Page, destination: string, amount: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New transfer" });
  await dialog.getByLabel("Source asset").selectOption("BTC");
  await dialog.getByLabel("Amount").fill(amount);
  await dialog.getByLabel("Destination").fill(destination);
  await dialog.getByRole("button", { name: "Submit request" }).click();
  const notice = page.getByRole("status").filter({ hasText: "recorded" });
  await expect(notice).toBeVisible();
  const match = (await notice.innerText()).match(/Transfer request (TX-[\w-]+) recorded/);
  if (!match) throw new Error("Missing created transaction ID");
  return match[1];
}

async function openRequest(page: Page, id: string) {
  await tab(page, "Digital Twin").click();
  const item = page.locator(".twin-transfer-list button").filter({ hasText: id });
  await expect(item).toContainText("PERSISTED REQUEST");
  await item.click();
  return page.getByLabel("Selected transfer details");
}

test("created request appears with policy checks and survives a refresh", async ({ page }) => {
  const id = await createTransfer(page, `Twin test ${Date.now()}`, "1.25");
  let detail = await openRequest(page, id);
  await expect(detail).toContainText(id);
  await expect(detail).toContainText("Pending approval");
  await expect(detail).toContainText("Requires evidence");
  await expect(detail).toContainText("Passed");
  await page.reload();
  detail = await openRequest(page, id);
  await expect(detail).toContainText("1.25 BTC");
  await expect(page.locator(".twin-transfer-list button").filter({ hasText: "SYNTHETIC SAMPLE" }).first()).toBeVisible();
});

test("approval appears as approved for processing with an audit", async ({ page }) => {
  const id = await createTransfer(page, "Demo Treasury", "1.25");
  await tab(page, "Policy Engine").click();
  const review = page.getByRole("region", { name: "Local demo transfer review" });
  await review.locator(".policy-review-list button").filter({ hasText: id }).click();
  await review.getByRole("button", { name: "Approve for processing" }).click();
  await expect(review.getByRole("status").filter({ hasText: "Approved for processing" })).toBeVisible();
  const detail = await openRequest(page, id);
  await expect(detail).toContainText("Status: Approved for processing");
  await expect(detail).toContainText("Reason: No reason supplied");
  await expect(detail).toContainText("Institutional evidence is not verified");
});

test("rejection appears with recorded reason and timestamp", async ({ page }) => {
  const id = await createTransfer(page, `Unverified twin ${Date.now()}`, "11");
  await tab(page, "Policy Engine").click();
  const review = page.getByRole("region", { name: "Local demo transfer review" });
  await review.locator(".policy-review-list button").filter({ hasText: id }).click();
  await review.getByLabel("Rejection reason").fill("Twin rejection test");
  await review.getByRole("button", { name: "Reject request" }).click();
  await expect(review.getByText(`${id} · Rejected`)).toBeVisible();
  const detail = await openRequest(page, id);
  await expect(detail).toContainText("Status: Rejected");
  await expect(detail).toContainText("Reason: Twin rejection test");
  await expect(detail.locator(".twin-audit")).toContainText(/\d{1,2}\/\d{1,2}\/\d{4}/);
});

test("graph selection, dragging, zoom, refresh, and layout remain intact", async ({ page }) => {
  await page.goto("/");
  await tab(page, "Digital Twin").click();
  const graph = page.getByRole("img", { name: "Interactive digital asset custody network" });
  const node = page.locator(".network-node").filter({ hasText: "BTC VAULT" });
  await expect(node).toBeVisible();
  const initial = await node.getAttribute("transform");
  const box = await node.boundingBox();
  if (!box) throw new Error("Graph node has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await expect(node).toHaveClass(/selected/);
  const dragged = await node.getAttribute("transform");
  expect(dragged).not.toBe(initial);
  const refreshed = page.waitForResponse(response => response.url().includes("/financial-data") && response.request().method() === "GET");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(node).toHaveAttribute("transform", dragged!);
  await graph.hover();
  await page.mouse.wheel(0, -200);
  await expect(page.getByRole("button", { name: "Reset graph zoom" })).not.toContainText("100%");
  await page.getByRole("button", { name: "Reset graph zoom" }).click();
  await expect(page.getByRole("button", { name: "Reset graph zoom" })).toContainText("100%");
  await expect(page.locator(".edges .selected-edge")).toHaveCount(1);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const inspector = page.locator(".inspector");
    const bounds = await inspector.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(graph).toBeVisible();
  }
});
