// Curve Fit workflow fixes from the fitting-workflow audit, in a real browser
// against the real backend (layout is the point — jsdom has none):
//   #18 a CSV "err" column is signal's error, not a second plotted curve;
//   #17 the window opens docked right, clear of the plot's Y axis;
//   #5  closing the window keeps the fit (curve, recipe, result);
//   #4  "Batch · N worksheets" has a usable height (it collapsed to 2 px).

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface Snapshot {
  hiddenChannels: number[];
  errKeys: Record<string, number>;
  overlayFor: string | null;
  fitModel: string | null;
}
type QzWindow = { __qz: { useApp: { getState: () => Record<string, unknown> } } };
/** The store fields these journeys assert on (read-only, via ?harness). */
const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState() as {
      hiddenChannels: number[];
      errKeys: Record<string, number>;
      fitOverlay: { datasetId: string } | null;
      datasets: { fitSpec?: { model: string } }[];
    };
    return {
      hiddenChannels: s.hiddenChannels,
      errKeys: s.errKeys,
      overlayFor: s.fitOverlay?.datasetId ?? null,
      fitModel: s.datasets[0]?.fitSpec?.model ?? null,
    };
  });

const curveFit = (page: Page) => page.locator(".qzk-win").filter({ has: page.getByText("Curve Fit", { exact: true }) });

test.describe("Curve Fit workflow (fitting audit)", () => {
  test("err column is not a curve; docked window; closing keeps the fit", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("decay-err.csv"));
    await waitForDatasetCount(page, 1);

    // #18: the error column is hidden as a curve and bound as signal's whiskers.
    await expect.poll(async () => (await snapshot(page)).hiddenChannels).toEqual([1]);
    expect((await snapshot(page)).errKeys).toEqual({ 0: 1 });

    await runPaletteCommand(page, "Curve fit…");
    const panel = curveFit(page);
    await expect(panel).toBeVisible();

    // #17: docked at the right edge — nowhere near the plot's left (Y-axis) side.
    const box = (await panel.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x + box.width).toBeGreaterThan(viewport.width - 40);
    expect(box.x).toBeGreaterThan(viewport.width / 2);

    await panel.getByRole("combobox", { name: "Model", exact: true }).selectOption({ label: "Exponential Decay" });
    await panel.getByRole("button", { name: "Fit", exact: true }).click();
    await expect(panel.getByText("reduced χ²")).toBeVisible({ timeout: 15_000 });
    // Key results are above the fold: the parameter table is in view.
    await expect(panel.getByRole("cell", { name: "τ" })).toBeInViewport();

    // #5: closing hides; the fit survives and comes back on reopen.
    await panel.getByRole("button", { name: "Close Curve Fit" }).click();
    await expect(panel).toHaveCount(0);
    const after = await snapshot(page);
    expect(after.overlayFor).not.toBeNull();
    expect(after.fitModel).toBe("Exponential Decay");
    await runPaletteCommand(page, "Curve fit…");
    await expect(curveFit(page).getByText("reduced χ²")).toBeVisible();
  });

  test("Batch · N worksheets has a usable height and opens", async ({ page }) => {
    await gotoApp(page);
    for (const f of ["dataset-a.csv", "dataset-b.csv"]) {
      await dropFileOnto(page, page.locator(".qzk-library"), fixturePath(f));
    }
    await waitForDatasetCount(page, 2);
    const rows = page.locator("[data-ds-id]");
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ["Control"] });
    await runPaletteCommand(page, "Curve fit…");
    const panel = curveFit(page);
    const toggle = panel.getByRole("button", { name: /Batch · 2 worksheets/ });
    await toggle.scrollIntoViewIfNeeded();
    const batch = panel.locator(".qzk-analysis-batch");
    // It collapsed to its 2 px border inside the scrolling flex body.
    expect((await batch.boundingBox())!.height).toBeGreaterThanOrEqual((await toggle.boundingBox())!.height);
    await toggle.click();
    await expect(panel.getByRole("button", { name: /Run Curve Fit .* batch/ })).toBeVisible();
  });
});
