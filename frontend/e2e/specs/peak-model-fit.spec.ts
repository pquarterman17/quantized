// Peak Analyzer — a real multi-peak fit through the mixed-shape model engine
// (PRIMARY_SOFTWARE_AUDIT_PLAN P2.4 slice 2), end to end against the REAL
// backend: import a synthetic two-peak pattern (fixtures/two-peaks.csv: a
// Gaussian at 36 deg, FWHM 0.4, height 800 and a Lorentzian at 44 deg, FWHM
// 0.6, height 400 on a 50 + (x - 30) background with a small deterministic
// ripple), find the peaks, give each its own shape, fit via
// /api/peaks/model-fit, and check the recovered peaks, the honest metrics
// label, the plot overlay, the report hand-off, and publishing the fit into
// the durable peak table, read back in the Peaks workshop as value ± error.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface StoreView {
  fitOverlay: { y: (number | null)[] } | null;
  reports: { report: unknown }[];
}

function readStore(page: Page): Promise<{ fitPoints: number; fitMax: number; reports: string[] }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => StoreView } } }).__qz.useApp.getState();
    const y = (s.fitOverlay?.y ?? []).filter((v): v is number => v !== null);
    return {
      fitPoints: y.length,
      fitMax: y.length ? Math.max(...y) : 0,
      reports: s.reports.map((r) => JSON.stringify(r.report)),
    };
  });
}

test.describe("Peak Analyzer mixed-shape model fit", () => {
  test("find two peaks, fit Gaussian + Lorentzian, report", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-peaks.csv"));
    await waitForDatasetCount(page, 1);

    await runPaletteCommand(page, "Peak Analyzer");
    const panel = page.locator(".qzk-win").filter({ has: page.getByText("Peak Analyzer", { exact: true }) });
    await expect(panel).toBeVisible();

    // ② find
    await panel.locator(".qzk-wizard-step", { hasText: "Find peaks" }).click();
    await panel.getByRole("button", { name: "Find peaks", exact: true }).click();
    await expect(panel.getByRole("checkbox")).toHaveCount(2, { timeout: 15_000 });

    // ③ model: the new engine is the default; peak 2 becomes a Lorentzian
    await panel.locator(".qzk-wizard-step", { hasText: "Model" }).click();
    await expect(panel.getByRole("combobox", { name: "fit engine" })).toHaveValue("model");
    await expect(panel.getByRole("combobox", { name: "peak 1 shape" })).toHaveValue("gaussian");
    await panel.getByRole("combobox", { name: "peak 2 shape" }).selectOption("lorentzian");
    await expect(panel.getByRole("combobox", { name: "background" })).toHaveValue("linear");
    await expect(panel.getByRole("textbox", { name: "#1 center start" })).toHaveValue(/^36/);

    // ④ fit against the real backend
    await panel.locator(".qzk-wizard-step", { hasText: "Fit & review" }).click();
    await panel.getByRole("button", { name: "Fit", exact: true }).click();
    const metrics = panel.getByLabel("fit metrics");
    await expect(metrics).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await expect(panel.getByText(/^converged ·/)).toBeVisible();

    // unweighted: SSR, never chi-square; the fit is excellent
    await expect(metrics).toContainText("SSR");
    await expect(metrics).not.toContainText("χ");
    const r2 = Number(await metrics.locator("span", { hasText: /^R²/ }).locator("span").nth(1).textContent());
    expect(r2).toBeGreaterThan(0.999);

    // recovered peaks: shapes as chosen, centres at 36 and 44 with errors
    const rows = panel.locator("table").filter({ has: page.getByRole("columnheader", { name: "area" }) }).locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Gauss");
    await expect(rows.nth(1)).toContainText("Lorentz");
    const centre = async (i: number) => Number((await rows.nth(i).locator("td").nth(2).textContent())?.split(" ")[0]);
    expect(Math.abs((await centre(0)) - 36)).toBeLessThan(0.01);
    expect(Math.abs((await centre(1)) - 44)).toBeLessThan(0.01);
    await expect(rows.nth(0).locator("td").nth(2)).toContainText("±");

    // the model curve is on the plot, over every fitted row
    const store = await readStore(page);
    expect(store.fitPoints).toBe(401);
    expect(store.fitMax).toBeGreaterThan(800);

    // components + residuals preview
    await expect(panel.getByRole("img", { name: /model fit preview/ })).toBeVisible();

    // ⑤ report through the peak_model_fit emitter
    await panel.locator(".qzk-wizard-step", { hasText: "Report" }).click();
    await panel.getByRole("button", { name: "→ Report" }).click();
    await expect.poll(async () => (await readStore(page)).reports.length).toBe(1);
    const report = (await readStore(page)).reports[0];
    expect(report).toContain("± area");
    expect(report).toContain("SSR = ");
    expect(report).not.toContain("χ²");

    // ④ → durable peak table (audit P2.1): publish, then the Peaks workshop
    // shows every value with its standard error
    await panel.locator(".qzk-wizard-step", { hasText: "Fit & review" }).click();
    await panel.getByRole("button", { name: "Publish to peak table" }).click();
    const table = () =>
      page.evaluate(() => {
        const s = (window as unknown as {
          __qz: { useApp: { getState: () => { datasets: { peakTable?: {
            provenance: { producer?: string };
            peaks: { center: number; centerErr: number | null; areaErr?: number | null; model: string }[];
          } }[] } } };
        }).__qz.useApp.getState();
        return s.datasets[0].peakTable ?? null;
      });
    await expect.poll(async () => (await table())?.provenance.producer ?? null).toBe("model_fit");
    const saved = (await table())!;
    expect(saved.peaks.map((p) => p.model)).toEqual(["Gaussian", "Lorentzian"]);
    for (const p of saved.peaks) {
      expect(p.centerErr).toBeGreaterThan(0);
      expect(p.areaErr).toBeGreaterThan(0);
    }

    await runPaletteCommand(page, "Find peaks…");
    const fitted = page.getByRole("table", { name: "fitted peaks" });
    await expect(fitted.locator("tbody tr")).toHaveCount(2, { timeout: 15_000 });
    const cells = fitted.locator("tbody tr").nth(0).locator("td");
    // "value ± error" in the centre and area cells, the value the fit found
    await expect(cells.nth(1)).toHaveText(/^\S+ ± \S+$/);
    const [centreText, errText] = ((await cells.nth(1).textContent()) ?? "").split(" ± ");
    expect(Math.abs(Number(centreText) - 36)).toBeLessThan(0.01);
    expect(Number(errText)).toBeGreaterThan(0);
    expect(Number(errText)).toBeCloseTo(saved.peaks[0].centerErr ?? NaN, 4);
    await expect(cells.nth(4)).toHaveText(/^\S+ ± \S+$/);
    await expect(page.getByText(/model fit · SSR = /)).toBeVisible();
  });
});
