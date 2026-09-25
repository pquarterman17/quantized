// Peak Analyzer batch — a saved recipe run over three datasets against the
// REAL backend (PRIMARY_SOFTWARE_AUDIT_PLAN P2.4 slice 4): the client
// prepares each dataset (range, find, the recipe's stored per-peak shapes),
// ONE job on the queue fits them (POST /api/peaks/model-fit-batch, polled
// through /api/jobs), and the uncertainty/diagnostic table comes back.
//
// Fixtures (same generator as two-peaks.csv: Gaussian + Lorentzian on a
// 50 + (x - 30) background with a deterministic 1.5*sin(7.3x) ripple):
//   two-peaks.csv          Gaussian 36 deg + Lorentzian 44 deg
//   two-peaks-shifted.csv  Gaussian 36.5 deg (FWHM 0.5) + Lorentzian 43.6 deg
//   two-peaks-counts.csv   the same kind of pattern, but its Y column is
//                          "Counts", not "Intensity" — the batch matches
//                          columns by name, so it is an ERROR ROW and the
//                          other two still fit (failure isolation).

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface Ds { id: string; name: string; data: { metadata: Record<string, unknown> } }
interface Store { datasets: Ds[] }
const datasets = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __qz: { useApp: { getState: () => Store } } }).__qz.useApp.getState().datasets.map((d) => ({
      id: d.id, name: d.name, peakBatch: d.data.metadata.peakBatch ?? null,
    })),
  );

// A saved v2 recipe: range 32..48, default find, model engine, peak 2 a
// Lorentzian (a stored per-peak shape the batch must carry to every dataset).
const RECIPE = {
  version: 2,
  name: "e2e batch",
  range: { lo: 32, hi: 48 },
  baseline: { method: "none", lam: 1e5, p: 0.01, radius: 50, order: 2 },
  find: { snr_threshold: 3, min_prominence: 0, max_peaks: 20 },
  model: { shape: "Gaussian", bgDegree: 1, linkMode: "None", constrain: false },
  report: { mode: "fit", regionWidth: 3 },
  fit: { engine: "model", shapes: [null, "lorentzian"], background: null, params: {}, shareFwhm: null, shareVary: {} },
};

test.describe("Peak Analyzer batch", () => {
  test("runs a saved recipe over three datasets and tabulates centres ± errors, one bad dataset isolated", async ({ page }) => {
    test.setTimeout(90_000);
    await gotoApp(page);
    const lib = page.locator(".qzk-library");
    await dropFileOnto(page, lib, fixturePath("two-peaks.csv"));
    await waitForDatasetCount(page, 1);
    await dropFileOnto(page, lib, fixturePath("two-peaks-shifted.csv"));
    await waitForDatasetCount(page, 2);
    await dropFileOnto(page, lib, fixturePath("two-peaks-counts.csv"));
    await waitForDatasetCount(page, 3);

    // The wizard's channels come from the ACTIVE dataset: make it the first.
    const all = await datasets(page);
    const nameOf = (stem: string) => all.find((d) => new RegExp(`^${stem}(\\.csv)?$`).test(d.name))!.name;
    const first = all.find((d) => d.name === nameOf("two-peaks"))!;
    await page.evaluate((id) => {
      (window as unknown as { __qz: { useApp: { getState: () => { setActive: (id: string) => void } } } })
        .__qz.useApp.getState().setActive(id);
    }, first.id);
    await page.evaluate((r) => localStorage.setItem("qz.peakRecipes", JSON.stringify([r])), RECIPE);

    await runPaletteCommand(page, "Peak Analyzer");
    const panel = page.locator(".qzk-win").filter({ has: page.getByText("Peak Analyzer", { exact: true }) });
    await expect(panel).toBeVisible();
    await panel.getByRole("tab", { name: "Batch" }).click();
    await expect(panel.getByRole("combobox", { name: "batch recipe" })).toHaveValue("e2e batch");
    await expect(panel.getByText(/Fits X \/ Intensity/)).toBeVisible();
    await panel.getByRole("button", { name: "All", exact: true }).click();
    await panel.getByRole("button", { name: "Run batch" }).click();

    const status = panel.getByRole("status", { name: "batch status" });
    await expect(status).toContainText("done · fitted 2/3 datasets", { timeout: 45_000 });
    await expect(panel.getByLabel("batch progress")).toHaveText("2/2");

    const table = panel.getByRole("table", { name: "batch results" });
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(5);
    const statuses = await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-status")));
    expect(statuses.filter((s) => s === "converged")).toHaveLength(4);
    const rowsOf = (name: string) => rows.filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${name.replace(/[.]/g, "\\.")}$`) }) });
    const bad = rowsOf(nameOf("two-peaks-counts"));
    await expect(bad).toHaveAttribute("data-status", "error");
    await expect(bad).toContainText('no column named "Intensity"');

    // Recovered centres (± a real error) and the recipe's stored shapes.
    const centre = async (name: string, peak: number) => {
      const row = rowsOf(name).nth(peak);
      return {
        shape: await row.locator("td").nth(2).textContent(),
        text: (await row.locator("td").nth(4).textContent()) ?? "",
      };
    };
    const truth: [string, number, number, string][] = [
      [first.name, 0, 36, "Gaussian"], [first.name, 1, 44, "Lorentzian"],
      [nameOf("two-peaks-shifted"), 0, 36.5, "Gaussian"], [nameOf("two-peaks-shifted"), 1, 43.6, "Lorentzian"],
    ];
    for (const [name, k, c, shape] of truth) {
      const got = await centre(name, k);
      expect(got.shape).toBe(shape);
      expect(Math.abs(Number(got.text.split(" ")[0]) - c)).toBeLessThan(0.02);
      expect(got.text).toMatch(/± \d/);
    }

    // Unweighted fits: the objective is SSR, never χ².
    await expect(table.locator('[data-objective="SSR"]')).toHaveCount(4);
    await expect(table).not.toContainText("χ²");

    // Into the library as a derived table naming the recipe and every source.
    await panel.getByRole("button", { name: "Add as table" }).click();
    await waitForDatasetCount(page, 4);
    const added = (await datasets(page)).find((d) => d.peakBatch !== null)!;
    expect(added.name).toBe("Peak batch — e2e batch (3 datasets)");
    const prov = added.peakBatch as { recipeName: string; sources: { name: string }[] };
    expect(prov.recipeName).toBe("e2e batch");
    expect(prov.sources.map((s) => s.name).sort()).toEqual(all.map((d) => d.name).sort());
  });
});
