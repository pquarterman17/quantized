// Peak Analyzer, audit P2.4 slice 3, end to end against the REAL backend on
// the two-peak fixture (fixtures/two-peaks.csv: a Gaussian at 36 deg, FWHM
// 0.4, and a Lorentzian at 44 deg, FWHM 0.6, on a sloped background):
//
//  1. "Peak Fitting ▸ Fit this range" — brush an x-range around the 44-deg
//     peak with Select Rows, right-click the plot, pick the entry: the Peak
//     Analyzer opens on step 2 with that range applied and the ONE peak inside
//     it found. With nothing selected the entry is disabled and says why.
//  2. Direct add — find both peaks, delete the second from the model table,
//     click the plot next to the 44-deg apex on step 2: a data-seeded
//     candidate is added (snapped onto the apex, measured FWHM), it appears
//     in the model table as peak #2, and the fit recovers both peaks.
//
// The plot's x scale is pinned with the store's `setXLim` so a data x maps to
// a known pixel (uPlot uses a fixed range verbatim), and the target lands in
// the left half of the plot, clear of the Peak Analyzer's tool window.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface Store {
  setXLim: (lim: [number, number] | null) => void;
  selection: { rows: number[] } | null;
  peakWizardOpen: boolean;
}
const store = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => Store } } }).__qz.useApp.getState();
    return { selected: s.selection?.rows.length ?? 0, wizardOpen: s.peakWizardOpen };
  });

async function loadPinned(page: Page, lim: [number, number]) {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-peaks.csv"));
  await waitForDatasetCount(page, 1);
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
  await page.evaluate((l) => {
    (window as unknown as { __qz: { useApp: { getState: () => Store } } }).__qz.useApp.getState().setXLim(l);
  }, lim);
}

/** Client pixel of data x on the stage plot, for a pinned [lo, hi] x range.
 *  Polls for the box: a new row selection adds a plotted series, and the plot
 *  is rebuilt — `.u-over` is briefly detached (measured: a null box). */
async function pixelAt(page: Page, lim: [number, number], x: number): Promise<{ x: number; y: number }> {
  const over = page.locator(".qzk-stage .u-over");
  let box: { x: number; y: number; width: number; height: number } | null = null;
  await expect.poll(async () => (box = await over.boundingBox()) !== null).toBe(true);
  const b = box!;
  return { x: b.x + ((x - lim[0]) / (lim[1] - lim[0])) * b.width, y: b.y + b.height * 0.5 };
}

const wizard = (page: Page) => page.locator(".qzk-win").filter({ has: page.getByText("Peak Analyzer", { exact: true }) });

test.describe("Peak Analyzer — Fit this range + direct add", () => {
  test("Peak Fitting ▸ Fit this range opens the analyzer on the brushed range with its peak found", async ({ page }) => {
    const lim: [number, number] = [40, 50];
    await loadPinned(page, lim);

    // No selection yet: the entry is there, disabled, with the reason.
    let at = await pixelAt(page, lim, 42);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.locator(".qzk-ctx-subwrap", { hasText: "Peak Fitting" }).hover();
    const entry = page.getByRole("menuitem", { name: "Fit this range" });
    await expect(entry).toBeDisabled();
    await expect(entry).toHaveAttribute("title", /select an x-range first/);
    await page.keyboard.press("Escape");

    // Brush 42..46 with Select Rows.
    await page.getByRole("button", { name: "Select Rows" }).click();
    const from = await pixelAt(page, lim, 42);
    const to = await pixelAt(page, lim, 46);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await store(page)).selected).toBeGreaterThan(60);

    at = await pixelAt(page, lim, 44);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.locator(".qzk-ctx-subwrap", { hasText: "Peak Fitting" }).hover();
    await expect(entry).toBeEnabled();
    await entry.click();

    const panel = wizard(page);
    await expect(panel).toBeVisible();
    await expect(panel.locator(".qzk-wizard-step.qzk-active")).toContainText("Find peaks");
    // exactly the 44-deg peak, found automatically inside the range
    const rows = panel.locator("table.qz-table tbody tr");
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
    const centre = Number(await rows.nth(0).locator("td").nth(1).textContent());
    expect(Math.abs(centre - 44)).toBeLessThan(0.1);
    // the range landed on step 1
    await panel.locator(".qzk-wizard-step", { hasText: "Range & baseline" }).click();
    const lo = Number(await panel.getByPlaceholder("from").inputValue());
    const hi = Number(await panel.getByPlaceholder("to").inputValue());
    expect(Math.abs(lo - 42)).toBeLessThan(0.15);
    expect(Math.abs(hi - 46)).toBeLessThan(0.15);
  });

  test("delete a peak from the model table, add it back by clicking the plot, and fit both", async ({ page }) => {
    const lim: [number, number] = [42, 52];
    await loadPinned(page, lim);
    await runPaletteCommand(page, "Peak Analyzer");
    const panel = wizard(page);
    await expect(panel).toBeVisible();

    await panel.locator(".qzk-wizard-step", { hasText: "Find peaks" }).click();
    await panel.getByRole("button", { name: "Find peaks", exact: true }).click();
    await expect(panel.getByRole("checkbox")).toHaveCount(2, { timeout: 15_000 });

    // ③ delete peak 2 (44 deg) from the model table
    await panel.locator(".qzk-wizard-step", { hasText: "Model" }).click();
    await panel.getByRole("button", { name: "remove peak 2" }).click();
    await expect(panel.getByRole("combobox", { name: "peak 2 shape" })).toHaveCount(0);
    await expect(panel.getByRole("textbox", { name: "#1 center start" })).toHaveValue(/^36/);

    // ② click the plot just off the 44-deg apex: a data-seeded peak
    await panel.locator(".qzk-wizard-step", { hasText: "Find peaks" }).click();
    await expect(panel.getByText(/Click the plot to add a peak/)).toBeVisible();
    const at = await pixelAt(page, lim, 44.08);
    await page.mouse.click(at.x, at.y);
    await expect(panel.getByRole("checkbox")).toHaveCount(2);
    const added = panel.locator("table.qz-table tbody tr").nth(1);
    const addedCentre = Number(await added.locator("td").nth(1).textContent());
    const addedFwhm = Number(await added.locator("td").nth(3).textContent());
    expect(Math.abs(addedCentre - 44)).toBeLessThan(0.051); // snapped onto the apex sample
    expect(addedFwhm).toBeGreaterThan(0.4); // measured from the data (true 0.6), not 2 % of the range
    expect(addedFwhm).toBeLessThan(0.8);

    // ③ it is model peak #2, seeded from that candidate
    await panel.locator(".qzk-wizard-step", { hasText: "Model" }).click();
    await panel.getByRole("combobox", { name: "peak 2 shape" }).selectOption("lorentzian");
    await expect(panel.getByRole("textbox", { name: "#2 center start" })).toHaveValue(/^44/);

    // ④ both peaks recovered by the real fit
    await panel.locator(".qzk-wizard-step", { hasText: "Fit & review" }).click();
    await panel.getByRole("button", { name: "Fit", exact: true }).click();
    await expect(panel.getByLabel("fit metrics")).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText(/^converged ·/)).toBeVisible();
    const results = panel.locator("table").filter({ has: page.getByRole("columnheader", { name: "area" }) }).locator("tbody tr");
    await expect(results).toHaveCount(2);
    const fitted = async (i: number) => Number((await results.nth(i).locator("td").nth(2).textContent())?.split(" ")[0]);
    expect(Math.abs((await fitted(0)) - 36)).toBeLessThan(0.01);
    expect(Math.abs((await fitted(1)) - 44)).toBeLessThan(0.01);
    expect((await store(page)).wizardOpen).toBe(true);
  });
});
