// UX audit: analysis tool windows must not cover the plot's Y-axis labels (nor
// the x10^n multiplier) while the user works. Baseline, Find peaks, Peak
// analyzer, Signal Processing and Waterfall export dock into the Inspector's
// column like Curve Fit (store/toolDock.ts); a window the user floated and
// moved keeps its position across close / reopen.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { classicLayout, gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

// Owner decision 2026-11-26: the window layout is now the default. This spec drives the CLASSIC layout
// (stage tabs, side-column tool windows), so it opts in explicitly and keeps its coverage.
test.beforeEach(async ({ page }) => {
  await classicLayout(page);
});

type Box = { left: number; top: number; right: number; bottom: number };

const TOOLS: { id: string; command: string; title: string }[] = [
  { id: "baseline", command: "Baseline / background…", title: "Baseline" },
  { id: "peaks", command: "Find peaks…", title: "Peaks" },
  { id: "peakwizard", command: "Peak analyzer…", title: "Peak analyzer" },
  { id: "signal-processing", command: "Signal processing…", title: "Signal processing" },
  { id: "waterfall", command: "Waterfall data export (CSV / 3-D)…", title: "Waterfall data export" },
];

/** The Y-axis area: from the plot's outer left edge to the plot body's left
 *  edge, over the body's height (tick labels, the x10^n multiplier, the title). */
async function yAxisArea(page: Page): Promise<Box> {
  return page.evaluate(() => {
    const plot = document.querySelector(".qzk-stage .uplot")!.getBoundingClientRect();
    const over = document.querySelector(".qzk-stage .u-over")!.getBoundingClientRect();
    return { left: plot.left, top: plot.top, right: over.left, bottom: over.bottom };
  });
}

async function boxOf(page: Page, id: string): Promise<Box> {
  return page.evaluate((winId) => {
    const r = document.querySelector(`[data-tool-window="${winId}"]`)!.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, id);
}

const intersects = (a: Box, b: Box): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

async function open(page: Page, tool: (typeof TOOLS)[number]): Promise<void> {
  await runPaletteCommand(page, tool.command);
  await expect(page.locator(`[data-tool-window="${tool.id}"]`)).toBeVisible();
}

test.describe("tool window placement @core", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-a.csv"));
    await waitForDatasetCount(page, 1);
    await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
  });

  for (const tool of TOOLS) {
    test(`${tool.title} leaves the Y-axis labels visible`, async ({ page }) => {
      const before = await yAxisArea(page);
      expect(before.right - before.left).toBeGreaterThan(20);
      await open(page, tool);
      const win = await boxOf(page, tool.id);
      const axis = await yAxisArea(page);
      expect(intersects(win, axis), `${tool.title} ${JSON.stringify(win)} vs Y axis ${JSON.stringify(axis)}`).toBe(false);
      await page.getByRole("button", { name: `Close ${tool.title}` }).click();
      await expect(page.locator(`[data-tool-window="${tool.id}"]`)).toHaveCount(0);
    });
  }

  test("a floated, moved window keeps its position on reopen", async ({ page }) => {
    const tool = TOOLS[0];
    await open(page, tool);
    await page.getByRole("button", { name: `Float ${tool.title}` }).click();
    const frame = page.locator(`[data-tool-window="${tool.id}"]`);
    await expect(frame).not.toHaveAttribute("data-docked", "");
    await frame.locator(".qzk-win-title").focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    const moved = await boxOf(page, tool.id);
    await page.getByRole("button", { name: `Close ${tool.title}` }).click();
    await expect(frame).toHaveCount(0);
    await open(page, tool);
    const again = await boxOf(page, tool.id);
    expect(again.left).toBe(moved.left);
    expect(again.top).toBe(moved.top);
  });
});
