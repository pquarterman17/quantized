// Peak Analyzer — a real multi-peak fit through the mixed-shape model engine
// (PRIMARY_SOFTWARE_AUDIT_PLAN P2.4 slice 2), end to end against the REAL
// backend: import a synthetic two-peak pattern (fixtures/two-peaks.csv: a
// Gaussian at 36 deg, FWHM 0.4, height 800 and a Lorentzian at 44 deg, FWHM
// 0.6, height 400 on a 50 + (x - 30) background with a small deterministic
// ripple), find the peaks, give each its own shape, fit via
// /api/peaks/model-fit, and check the recovered peaks, the honest metrics
// label, the plot overlay, publishing to the durable peak table (P2.1
// uncertainties: the Peaks workshop then shows value ± error), and the report
// hand-off.

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

interface TableRow { center: number; centerErr: number | null; heightErr: number | null; model: string }

function readPeakTable(page: Page): Promise<{ producer: string | undefined; rows: TableRow[] } | null> {
  return page.evaluate(() => {
    type S = { datasets: { peakTable?: { peaks: TableRow[]; provenance: { producer?: string } } }[] };
    const s = (window as unknown as { __qz: { useApp: { getState: () => S } } }).__qz.useApp.getState();
    const t = s.datasets[0]?.peakTable;
    return t ? { producer: t.provenance.producer, rows: t.peaks } : null;
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

    // publish to the durable peak table (audit P2.1 uncertainties): one row
    // per peak with its shape, value and standard error, producer model_fit
    await panel.getByRole("button", { name: "Publish to peak table" }).click();
    await expect(panel.getByRole("status").filter({ hasText: /published 2 peaks/ })).toBeVisible();
    const table = await readPeakTable(page);
    expect(table?.producer).toBe("model_fit");
    expect(table?.rows.map((r) => r.model)).toEqual(["gaussian", "lorentzian"]);
    for (const r of table?.rows ?? []) {
      // every error the fit determined is a positive finite number, never 0 / NaN
      expect(r.centerErr).toBeGreaterThan(0);
      expect(r.heightErr).toBeGreaterThan(0);
    }
    expect(Math.abs((table?.rows[0].center ?? 0) - 36)).toBeLessThan(0.01);

    // ⑤ report through the peak_model_fit emitter
    await panel.locator(".qzk-wizard-step", { hasText: "Report" }).click();
    await panel.getByRole("button", { name: "→ Report" }).click();
    await expect.poll(async () => (await readStore(page)).reports.length).toBe(1);
    const report = (await readStore(page)).reports[0];
    expect(report).toContain("± area");
    expect(report).toContain("SSR = ");
    expect(report).not.toContain("χ²");

    // the Peaks workshop shows the published table as value ± error
    await runPaletteCommand(page, "Find peaks…");
    const peaks = page.locator(".qzk-win").filter({ has: page.getByText("Peaks", { exact: true }) });
    const fitted = peaks.getByRole("table", { name: "fitted peaks" });
    await expect(fitted.locator("tbody tr")).toHaveCount(2, { timeout: 15_000 });
    for (const [i, want] of [[0, 36], [1, 44]] as const) {
      const cell = fitted.locator("tbody tr").nth(i).locator("td").nth(1);
      await expect(cell).toHaveText(/^[\d.]+ ± [\d.e+-]+$/); // "value ± error", never "± —"
      const [value, err] = ((await cell.textContent()) ?? "").split(" ± ").map(Number);
      expect(Math.abs(value - want)).toBeLessThan(0.01);
      expect(err).toBeGreaterThan(0);
    }
    await expect(peaks.getByText(/Peak Analyzer model fit/)).toBeVisible();
  });
});
