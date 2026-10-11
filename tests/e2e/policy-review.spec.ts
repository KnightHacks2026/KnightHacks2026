import { expect, test } from "./authenticated-test";

const nav = (page: import("@playwright/test").Page, name: string) =>
  page.locator(".section-tabs").getByRole("button", { name, exact: true });

async function create(page: import("@playwright/test").Page, destination: string, amount: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New transfer", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New transfer" });
  await dialog.getByLabel("Source asset").selectOption("BTC");
  await dialog.getByLabel("Amount").fill(amount);
  await dialog.getByLabel("Destination").fill(destination);
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("status").filter({ hasText: "recorded" })).toBeVisible();
  const row = page.locator(".tx-row").filter({ hasText: destination });
  const id = await row.locator("small").first().innerText();
  return id;
}

test("synthetic transfer can be approved once with an immutable audit and persistent status", async ({ page, request }) => {
  const id = await create(page, "Demo Treasury", "1.25");
  await nav(page, "Policy Engine").click();
  const review = page.getByRole("region", { name: "Local demo transfer review" });
  await review.locator(".policy-review-list button").filter({ hasText: id }).click();
  await expect(review.getByText("Requires evidence").first()).toBeVisible();
  await review.getByRole("button", { name: "Approve for processing" }).click();
  await expect(review.getByRole("status").filter({ hasText: "Approved for processing" })).toBeVisible();
  await expect(review.getByText(`${id} · Approved for processing`)).toBeVisible();
  const duplicate = await request.post(`/api/transfer/reviews/${encodeURIComponent(id)}/decision`, {
    data: { contractVersion: "1.0.0", decision: "approve", expectedRevision: 1, reason: "" },
  });
  expect(duplicate.status()).toBe(409);
  await page.reload();
  await nav(page, "Transactions").click();
  await expect(page.locator(".tx-row").filter({ hasText: id })).toContainText("Approved for processing");
  const audits = await request.get("/api/transfer/reviews");
  const body = await audits.json();
  expect(body.data.audit.filter((event: { transactionId: string }) => event.transactionId === id)).toHaveLength(1);
});

test("missing evidence blocks approval and rejection records a reason", async ({ page, request }) => {
  const destination = `Unverified ${Date.now()}`;
  const id = await create(page, destination, "11");
  await nav(page, "Policy Engine").click();
  const review = page.getByRole("region", { name: "Local demo transfer review" });
  await review.locator(".policy-review-list button").filter({ hasText: id }).click();
  await expect(review.getByRole("button", { name: "Approve for processing" })).toBeDisabled();
  const blocked = await request.post(`/api/transfer/reviews/${encodeURIComponent(id)}/decision`, {
    data: { contractVersion: "1.0.0", decision: "approve", expectedRevision: 1, reason: "" },
  });
  expect(blocked.status()).toBe(409);
  await review.getByRole("button", { name: "Reject request" }).click();
  await expect(review.getByRole("alert")).toContainText("Enter a rejection reason");
  await review.getByLabel("Rejection reason").fill("Missing destination evidence");
  await review.getByRole("button", { name: "Reject request" }).click();
  await expect(review.getByText(`${id} · Rejected`)).toBeVisible();
  await expect(review.locator(".policy-audit li").filter({ hasText: id })).toContainText("Missing destination evidence");
  await page.reload();
  await nav(page, "Transactions").click();
  await expect(page.locator(".tx-row").filter({ hasText: id })).toContainText("Rejected");
});

test("review area remains within the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await nav(page, "Policy Engine").click();
  const review = page.getByRole("region", { name: "Local demo transfer review" });
  await expect(review).toBeVisible();
  const box = await review.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});

test("selected review stays readable and keyboard selectable on desktop and mobile", async ({ page }) => {
  const firstId = await create(page, "Demo Treasury", "1.25");
  const secondId = await create(page, "Demo Treasury", "2.5");
  await nav(page, "Policy Engine").click();
  const review = page.getByRole("region", { name: "Local demo transfer review" });
  const first = review.locator(".policy-review-list button").filter({ hasText: firstId });
  const second = review.locator(".policy-review-list button").filter({ hasText: secondId });

  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(second).toHaveAttribute("aria-pressed", "false");
  await expect(first).toContainText("1.25 BTC → Demo Treasury");
  await expect(first).toContainText("Ready for demo review");

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const colors = await first.evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      id: getComputedStyle(element.querySelector("strong")!).color,
      detail: getComputedStyle(element.querySelector("small")!).color,
      status: getComputedStyle(element.querySelector("em")!).color,
    }));
    expect(colors).toEqual({ background: "rgb(242, 237, 246)", id: "rgb(36, 29, 45)",
      detail: "rgb(112, 103, 121)", status: "rgb(104, 70, 154)" });
    const box = await first.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }

  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(first).toHaveAttribute("aria-pressed", "false");
});
