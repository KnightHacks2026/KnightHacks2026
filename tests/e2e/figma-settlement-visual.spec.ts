import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 1200 }]) {
  test(`${viewport.name} settlement arrows and root label stay aligned through every scenario`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.locator(".section-tabs").getByRole("button", { name: "Digital Twin" }).click();
    await page.getByRole("group", { name: "Digital Twin mode" }).getByRole("button", { name: "Settlement Simulation" }).click();
    const canvas = page.locator(".settlement-canvas");
    const links = canvas.locator(".settlement-graph__link");
    const output = `artifacts/settlement-visual/${viewport.name}`;
    await mkdir(output, { recursive: true });
    const captureWorkspace = async (name: string) => canvas.screenshot({
      path: `${output}/${name}-workspace.png`,
      style: ".topbar,.sectionbar,.statusbar { visibility:hidden !important; }",
    });

    const capture = async (name: string) => {
      // The fixed page status bar can cover the bottom of a tall mobile graph capture.
      await page.locator(".statusbar").evaluate(element => { (element as HTMLElement).style.visibility = "hidden"; });
      await canvas.locator(".settlement-graph").screenshot({ path: `${output}/${name}.png` });
      await page.locator(".statusbar").evaluate(element => { (element as HTMLElement).style.visibility = ""; });
      const geometry = await canvas.evaluate(element => {
        const nodes = [...element.querySelectorAll<HTMLElement>(".settlement-node")];
        const links = [...element.querySelectorAll<HTMLElement>(".settlement-graph__link")];
        const label = element.querySelector<HTMLElement>(".settlement-root-cause")!;
        const box = (item: Element) => item.getBoundingClientRect();
        return { nodes: nodes.map(box), links: links.map(box), paths: links.map(link => box(link.querySelector("svg")!)), label: box(label), colors: links.map(link => getComputedStyle(link).color), animations: links.map(link => getComputedStyle(link.querySelector("i")!).animationName) };
      });
      expect(geometry.label.bottom).toBeLessThanOrEqual(geometry.nodes[0].top - 5);
      for (let index = 0; index < 2; index++) {
        if (viewport.name === "desktop") {
          expect(Math.abs((geometry.links[index].top + geometry.links[index].height / 2) - (geometry.nodes[index].top + geometry.nodes[index].height / 2))).toBeLessThan(7);
          expect(geometry.links[index].left).toBeGreaterThanOrEqual(geometry.nodes[index].right - 1);
          expect(geometry.links[index].right).toBeLessThanOrEqual(geometry.nodes[index + 1].left + 1);
        } else {
          expect(Math.abs((geometry.links[index].left + geometry.links[index].width / 2) - (geometry.nodes[index].left + geometry.nodes[index].width / 2))).toBeLessThan(7);
          expect(geometry.paths[index].top).toBeGreaterThanOrEqual(geometry.nodes[index].bottom - 1);
          expect(geometry.paths[index].bottom).toBeLessThanOrEqual(geometry.nodes[index + 1].top + 1);
        }
      }
      return geometry;
    };

    const before = await capture("before");
    expect(before.colors[0]).toBe(before.colors[1]);
    expect(before.animations).toEqual(["none", "none"]);

    await canvas.getByRole("button", { name: "Fund $10M" }).click();
    await canvas.getByRole("button", { name: "Run Simulation" }).click();
    await expect(canvas).toHaveAttribute("data-phase", "flow12");
    const first = await capture("first-arrow");
    expect(first.colors[0]).not.toBe(before.colors[0]);
    expect(first.colors[1]).toBe(before.colors[1]);
    await expect(canvas).toHaveAttribute("data-phase", "flow23");
    const second = await capture("second-arrow");
    expect(second.colors[0]).toBe(first.colors[0]);
    expect(second.colors[1]).toBe(first.colors[0]);
    await expect(canvas).toHaveAttribute("data-phase", "complete");
    const completed = await capture("fund-10m-complete");
    await captureWorkspace("fund-10m");
    expect(completed.colors).toEqual([first.colors[0], first.colors[0]]);
    expect(completed.animations).toEqual(["none", "none"]);

    await canvas.getByRole("button", { name: "Baseline" }).click();
    await canvas.getByRole("button", { name: "Run Simulation" }).click();
    await expect(canvas).toHaveAttribute("data-phase", "complete");
    const baseline = await capture("baseline-complete");
    await captureWorkspace("baseline");
    expect(baseline.colors[0]).not.toBe(first.colors[0]);
    expect(baseline.animations).toEqual(["none", "none"]);

    await canvas.getByRole("button", { name: "Fund $5M" }).click();
    await canvas.getByRole("button", { name: "Run Simulation" }).click();
    await expect(canvas).toHaveAttribute("data-phase", "complete");
    const partial = await capture("fund-5m-complete");
    await captureWorkspace("fund-5m");
    expect(partial.colors[0]).toBe(partial.colors[1]);
    expect(partial.colors[0]).not.toBe(before.colors[0]);
    expect(partial.colors[0]).not.toBe(first.colors[0]);
    expect(partial.animations).toEqual(["none", "none"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}
