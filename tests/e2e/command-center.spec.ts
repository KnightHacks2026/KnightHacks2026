import { expect, test } from "@playwright/test";

test("command center renders the graph and compares a selected scenario", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Three-leg settlement cascade" })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);

  const scenarios = page.getByRole("radiogroup", { name: "Choose a scenario" });
  const full = scenarios.getByRole("radio", { name: /Full-gap transfer/ });
  const partial = scenarios.getByRole("radio", { name: /Partial transfer/ });
  await expect(full).toHaveAttribute("aria-checked", "true");
  await partial.click();
  await expect(partial).toHaveAttribute("aria-checked", "true");
  await expect(full).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".cc-transfer")).toContainText("USD 5.00");

  await page.getByRole("button", { name: "Run comparison" }).click();
  await expect(page.getByText("ENGINE RESULT")).toBeVisible();
  await expect(page.locator(".cc-comparison-insight")).toContainText("3 still blocked");
});
