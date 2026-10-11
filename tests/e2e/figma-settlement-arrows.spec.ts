import { expect, test } from "@playwright/test";

const scenarios = [
  { name: "Baseline", color: "rgb(178, 95, 92)", status: "Dependency blocked", finalClass: "is-blocked", meaning: "blocked-dependency" },
  { name: "Fund $5M", color: "rgb(189, 132, 53)", status: "Dependency blocked", finalClass: "is-partial-blocked", meaning: "blocked-dependency" },
  { name: "Fund $10M", color: "rgb(39, 132, 95)", status: "Projected settled", finalClass: "is-restored", meaning: "projected-proceeds" },
] as const;
type ArrowSample = { phase: string; statuses: string[]; links: string[]; colors: string[]; animations: string[]; durations: string[]; easings: string[]; paths: string[]; start?: number; later?: number };

async function openSimulation(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator(".section-tabs").getByRole("button", { name: "Digital Twin" }).click();
  await page.getByRole("group", { name: "Digital Twin mode" }).getByRole("button", { name: "Settlement Simulation" }).click();
  return page.locator(".settlement-canvas");
}

for (const scenario of scenarios) {
  test(`${scenario.name} signals travel left to right, arrive in order, retain color, and replay`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const canvas = await openSimulation(page);
    await canvas.getByRole("button", { name: scenario.name, exact: true }).click();
    await canvas.evaluate(element => {
      const samples: ArrowSample[] = [];
      (window as Window & { arrowSamples?: ArrowSample[] }).arrowSamples = samples;
      const capture = () => {
        const phase = element.getAttribute("data-phase") || "";
        const links = [...element.querySelectorAll<HTMLElement>(".settlement-graph__link")];
        const sample: ArrowSample = {
          phase,
          statuses: [...element.querySelectorAll(".settlement-node__status")].map(node => node.textContent || ""),
          links: links.map(link => link.className),
          colors: links.map(link => getComputedStyle(link).color),
          animations: links.map(link => getComputedStyle(link.querySelector("i")!).animationName),
          durations: links.map(link => getComputedStyle(link.querySelector("i")!).animationDuration),
          easings: links.map(link => getComputedStyle(link.querySelector("i")!).animationTimingFunction),
          paths: links.map(link => link.querySelector("svg")?.innerHTML || ""),
        };
        samples.push(sample);
        if (phase === "flow12" || phase === "flow23") {
          const signal = links[phase === "flow12" ? 0 : 1].querySelector("i")!;
          sample.start = signal.getBoundingClientRect().left;
          window.setTimeout(() => { sample.later = signal.getBoundingClientRect().left; }, 220);
        }
      };
      new MutationObserver(capture).observe(element, { attributes: true, attributeFilter: ["data-phase"] });
    });

    await canvas.getByRole("button", { name: "Run Simulation" }).click();
    await expect(canvas).toHaveAttribute("data-phase", "complete");
    const samples = await page.evaluate(() => (window as Window & { arrowSamples?: ArrowSample[] }).arrowSamples || []);
    const first = samples.find(sample => sample.phase === "flow12")!;
    const second = samples.find(sample => sample.phase === "flow23")!;
    const atLeg2 = samples.find(sample => sample.phase === "leg2")!;
    const atLeg3 = samples.find(sample => sample.phase === "leg3")!;
    expect(first.statuses).toEqual([scenario.name === "Fund $10M" ? "Projected settled" : scenario.name === "Fund $5M" ? "Partially funded" : "Liquidity shortfall", "Awaiting upstream", "Awaiting upstream"]);
    expect(second.statuses).toEqual([first.statuses[0], scenario.status, "Awaiting upstream"]);
    expect(atLeg2.statuses?.[1]).toBe(scenario.status);
    expect(atLeg3.statuses?.[2]).toBe(scenario.status);
    expect(first.links?.[0]).toContain("is-propagating");
    expect(first.links?.[1]).not.toContain("is-propagating");
    expect(second.links?.[0]).not.toContain("is-propagating");
    expect(second.links?.[1]).toContain("is-propagating");
    for (const [sample, index] of [[first, 0], [second, 1]] as const) {
      expect(sample.animations?.[index]).toBe("settlement-travel-link");
      expect(sample.durations?.[index]).toBe("0.46s");
      expect(sample.easings?.[index]).toBe("ease-in-out");
      expect(sample.colors?.[index]).toBe(scenario.color);
      expect(sample.later).toBeGreaterThan(sample.start! + 1);
    }
    expect(first.paths).toEqual(second.paths);
    await expect(canvas.locator(`.settlement-graph__link.${scenario.finalClass}`)).toHaveCount(2);
    await expect(canvas.locator(".settlement-graph__link.is-propagating")).toHaveCount(0);
    expect(await canvas.locator(".settlement-graph__link").evaluateAll(links => links.map(link => ({ color: getComputedStyle(link).color, meaning: link.getAttribute("data-signal"), animation: getComputedStyle(link.querySelector("i")!).animationName })))).toEqual([
      { color: scenario.color, meaning: scenario.meaning, animation: "none" },
      { color: scenario.color, meaning: scenario.meaning, animation: "none" },
    ]);
    await canvas.getByRole("button", { name: "Replay Simulation" }).click();
    await expect(canvas).toHaveAttribute("data-phase", "ready");
    await expect(canvas.locator(`.settlement-graph__link.${scenario.finalClass}`)).toHaveCount(0);
    await expect(canvas).toHaveAttribute("data-phase", "complete");
    await expect(canvas.locator(`.settlement-graph__link.${scenario.finalClass}`)).toHaveCount(2);
  });

  test(`${scenario.name} reduced motion finishes without traveling signals`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const canvas = await openSimulation(page);
    await canvas.getByRole("button", { name: scenario.name, exact: true }).click();
    await canvas.getByRole("button", { name: "Run Simulation" }).click();
    await expect(canvas).toHaveAttribute("data-phase", "complete");
    await expect(canvas.locator(`.settlement-graph__link.${scenario.finalClass}`)).toHaveCount(2);
    await expect(canvas.locator(".settlement-graph__link.is-propagating")).toHaveCount(0);
    expect(await canvas.locator(".settlement-graph__link i").evaluateAll(signals => signals.map(signal => getComputedStyle(signal).animationName))).toEqual(["none", "none"]);
    await canvas.getByRole("button", { name: "Replay Simulation" }).click();
    await expect(canvas).toHaveAttribute("data-phase", "complete");
    await expect(canvas.locator(`.settlement-graph__link.${scenario.finalClass}`)).toHaveCount(2);
  });
}
