// Origin-replacement journey 3 — fitting & peaks, the NLFit way.
//
// decay-err.csv is y0 + A1*exp(-t/t1) with y0 = 0.2, A1 = 3, t1 = 2 plus
// noise, and an "err" column. The Origin user picks the built-in ExpDec1,
// holds y0, weights by the error column, fits, reads the report (Origin's
// parameter table + ANOVA), turns on the confidence band, then batch-fits
// three worksheets and runs the Peak Analyzer wizard on two Gaussian peaks.
// Assertions are on fitted VALUES and on store state, not on mock calls.

import { expect, test, type Locator, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface FitView {
  model: string;
  params: number[];
  errors: (number | null)[];
  nFree: number | null;
  weight: unknown;
  band: boolean;
}
type QzWindow = { __qz: { useApp: { getState: () => Record<string, unknown> } } };

/** The active dataset's saved fit recipe + result (read-only, via ?harness). */
const fitOf = (page: Page): Promise<FitView | null> =>
  page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState() as {
      activeId: string | null;
      fitOverlay: { band?: unknown } | null;
      datasets: {
        id: string;
        fitSpec?: { model: string; params?: number[]; errors?: (number | null)[]; nFree?: number; weight?: unknown };
      }[];
    };
    const spec = s.datasets.find((d) => d.id === s.activeId)?.fitSpec;
    if (!spec) return null;
    return {
      model: spec.model,
      params: spec.params ?? [],
      errors: spec.errors ?? [],
      nFree: spec.nFree ?? null,
      weight: spec.weight ?? null,
      band: Boolean(s.fitOverlay?.band),
    };
  });

const curveFit = (page: Page): Locator =>
  page.locator(".qzk-win").filter({ has: page.getByText("Curve Fit", { exact: true }) });

test.describe("Origin journey: fitting and peaks", () => {
  test("ExpDec1 with a held parameter, error weighting, report and band", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("decay-err.csv"));
    await waitForDatasetCount(page, 1);
    await runPaletteCommand(page, "Curve fit…");
    const panel = curveFit(page);
    await expect(panel).toBeVisible();

    // Origin's built-in ExpDec1: y = y0 + A1*exp(-x/t1).
    await panel.getByRole("combobox", { name: "Model", exact: true }).selectOption({ label: "ExpDec1" });
    await panel.getByRole("button", { name: /Start values & bounds/ }).click();
    await panel.getByLabel("Start value of y0").fill("0.2");
    await panel.getByLabel("Hold y0 fixed").check();
    await panel.getByRole("combobox", { name: "Weighting" }).selectOption({ label: "Y error column" });
    await panel.getByRole("button", { name: "Fit", exact: true }).click();

    await expect.poll(async () => (await fitOf(page))?.model ?? null, { timeout: 15_000 }).toBe("ExpDec1");
    const fit = (await fitOf(page))!;
    // Held y0 stays exactly where it was put and gets no uncertainty.
    expect(fit.params[0]).toBe(0.2);
    expect(fit.errors[0]).toBeNull();
    expect(fit.nFree).toBe(2);
    expect(fit.params[1]).toBeCloseTo(3, 1);
    expect(fit.params[2]).toBeCloseTo(2, 1);
    expect(fit.errors[1]).toBeGreaterThan(0);
    expect(JSON.stringify(fit.weight)).toContain("err");
    await expect(page.locator(".qzk-statusbar")).toContainText("fitted ExpDec1");

    // The report: Origin's parameter table and ANOVA with the held parameter
    // out of the regression degrees of freedom (2 free of 3; N = 41).
    await panel.getByText("Fit report", { exact: true }).click();
    await expect(panel.getByText("ANOVA", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("Prob>|t|")).toBeVisible();
    const anovaRow = (source: string) =>
      panel.getByRole("row").filter({ has: page.getByRole("cell", { name: source, exact: true }) });
    await expect(anovaRow("Regression").getByRole("cell").nth(1)).toHaveText("2");
    await expect(anovaRow("Residual").getByRole("cell").nth(1)).toHaveText("39");
    await panel.getByText("Fit report", { exact: true }).click();

    // The 95 % confidence band, on the graph itself.
    await panel.getByRole("checkbox", { name: "Bands" }).check();
    await expect(panel.getByText(/95% CI ±/)).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await fitOf(page))?.band ?? false).toBe(true);
    await expect(page.locator(".qzk-stage .qzk-legend").first()).toContainText("95% confidence band");
  });

  test("batch fit of three worksheets", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoApp(page);
    const library = page.locator(".qzk-library");
    for (const [i, f] of ["dataset-a.csv", "dataset-b.csv", "linear-ramp.csv"].entries()) {
      await dropFileOnto(page, library, fixturePath(f));
      await waitForDatasetCount(page, i + 1);
    }
    const rows = page.locator("[data-ds-id]");
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ["Control"] });
    await rows.nth(2).click({ modifiers: ["Control"] });
    await runPaletteCommand(page, "Curve fit…");
    const panel = curveFit(page);
    await panel.getByRole("combobox", { name: "Model", exact: true }).selectOption({ label: "Linear" });
    const toggle = panel.getByRole("button", { name: /Batch · 3 worksheets/ });
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    const batch = panel.locator(".qzk-analysis-batch");
    await batch.getByRole("button", { name: "Run Curve Fit (Linear) batch" }).click();
    // Every worksheet reaches a final status; none fails.
    for (const name of ["dataset-a.csv", "dataset-b.csv", "linear-ramp.csv"]) {
      await expect(batch.getByRole("row", { name: new RegExp(name.replace(".", "\\.")) })).toContainText("Completed", {
        timeout: 20_000,
      });
    }
    await expect(batch.getByText(/Failed|Error/)).toHaveCount(0);
  });

  test("Peak Analyzer wizard fits two Gaussian peaks", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-peaks.csv"));
    await waitForDatasetCount(page, 1);
    await runPaletteCommand(page, "Peak Analyzer");
    const pa = page.locator(".qzk-win").filter({ has: page.getByText("Peak Analyzer", { exact: true }) });
    await expect(pa).toBeVisible();
    const next = pa.getByRole("button", { name: "Next →" });

    await next.click(); // 1 Range & baseline -> 2 Find peaks
    await pa.getByRole("button", { name: "Find peaks", exact: true }).click();
    const found = pa.getByRole("row").filter({ hasText: "×" });
    await expect(found).toHaveCount(2, { timeout: 15_000 });

    await next.click(); // -> 3 Model
    await expect(pa.getByText("Fit engine", { exact: false }).first()).toBeVisible();
    await next.click(); // -> 4 Fit & review
    await pa.getByRole("button", { name: "Fit", exact: true }).click();
    await expect(pa.getByText(/converged/)).toBeVisible({ timeout: 20_000 });
    // Centres at 36 and 44 degrees (the fixture's peaks), each with an error.
    const centres = await pa
      .getByRole("row")
      .filter({ hasText: "Gauss" })
      .evaluateAll((rs) => rs.map((r) => Number.parseFloat(r.querySelectorAll("td")[2]?.textContent ?? "NaN")));
    expect(centres).toHaveLength(2);
    expect(centres[0]).toBeCloseTo(36, 1);
    expect(centres[1]).toBeCloseTo(44, 1);
    await expect(pa.getByText(/^R² 0\.99/)).toBeVisible();
  });
});
