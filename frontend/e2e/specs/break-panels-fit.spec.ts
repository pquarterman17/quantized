// Batch 34 (layout-fit style): on-screen x-break panels must keep a usable
// plot area in a small window. Measured before the fix at 800x600 (a ~294 px
// stage): every panel drew its own y gutter, title and right pad (~128 px),
// so both NbAu_XRR_v2.refl panels (break 0.15-0.30) and all three Cu3Au XRD
// panels came out 0-1 px wide. Now right-of-seam panels share panel 0's y
// axis (as the export does) and the row falls back from span-proportional to
// equal widths when a panel would drop below MIN_BREAK_PLOT_W
// (`components/Stage/breakPanelLayout.ts`). jsdom has no layout, so the real
// promise lives here. Synthetic fixture only (see utils/fixtures.ts).

import { expect, type Page, test } from "@playwright/test";

import { MIN_BREAK_PLOT_W } from "../../src/components/Stage/breakPanelLayout";
import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

interface Case {
  name: string;
  /** two-peaks.csv runs x 30..50. */
  breaks: [number, number][];
  /** The narrowest plot area allowed at each window width. At 800 px three
   *  panels share a ~294 px stage with panel 0's ~100 px y axis and two seams,
   *  so the floor there is what equal widths can give, not the fallback
   *  threshold. */
  floor: Record<number, number>;
}

const CASES: Case[] = [
  // spans 1 : 4 — span-proportional widths would squeeze the left panel.
  { name: "one break", breaks: [[31, 46]], floor: { 800: MIN_BREAK_PLOT_W, 1000: MIN_BREAK_PLOT_W, 1360: MIN_BREAK_PLOT_W } },
  // spans 2 : 1 : 2
  { name: "two breaks", breaks: [[32, 40], [41, 48]], floor: { 800: 24, 1000: MIN_BREAK_PLOT_W, 1360: MIN_BREAK_PLOT_W } },
];
const SIZES = [
  { width: 800, height: 600 },
  { width: 1000, height: 700 },
  { width: 1360, height: 900 },
];

/** Every break panel's plot-area width (CSS px), left to right. */
function plotWidths(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".qzk-stage .uplot .u-over")].map((o) => o.getBoundingClientRect().width),
  );
}

for (const c of CASES) {
  test(`x-break panels keep a usable plot area in a small window: ${c.name}`, async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-peaks.csv"));
    await waitForDatasetCount(page, 1);
    await page.locator("[data-ds-id]").first().click();
    await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
    await page.evaluate((breaks) => {
      const app = (window as unknown as {
        __qz: { useApp: { getState: () => { activeId: string; breakAtGaps: (id: string, b: [number, number][]) => void } } };
      }).__qz.useApp;
      app.getState().breakAtGaps(app.getState().activeId, breaks);
    }, c.breaks);
    const n = c.breaks.length + 1;
    await expect(page.locator(".qzk-stage .uplot")).toHaveCount(n);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const floor = c.floor[size.width];
      // The row re-lays out on the host's ResizeObserver; poll until it has.
      await expect
        .poll(async () => Math.min(...(await plotWidths(page))), {
          message: `narrowest break plot area at ${size.width}x${size.height}`,
        })
        .toBeGreaterThanOrEqual(floor);
      const ws = await plotWidths(page);
      expect(ws, `${n} panels at ${size.width}`).toHaveLength(n);
    }
  });
}
