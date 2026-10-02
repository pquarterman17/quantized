// SIMS depth profiles (PRIMARY_SOFTWARE_AUDIT_PLAN P2.3), end to end against
// the real parser and `/api/sims/process`: a raw sputter-TIME export imports
// labelled as time (s), the workshop previews the crater calibration +
// background + matrix normalization while NOTHING is created, and Create adds
// one derived dataset with per-stage provenance and a recorded `sims` step
// that undo removes.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

type Snapshot = {
  datasets: { name: string; data: { time: number[]; values: (number | null)[][]; units: string[]; metadata: Record<string, unknown> } }[];
  macroSteps: { kind: string; params: Record<string, unknown> }[];
};
const store = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => Snapshot } } }).__qz.useApp.getState();
    return { datasets: s.datasets, macroSteps: s.macroSteps };
  });

test.describe("SIMS depth-profile workshop (P2.3)", () => {
  test("time profile → live preview → create → provenance, recorded step, undo", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("sims-time-profile.csv"));
    await waitForDatasetCount(page, 1);
    const imported = (await store(page)).datasets[0];
    expect(imported.data.metadata).toMatchObject({ parser_name: "import_sims", x_column_name: "Time", x_column_unit: "s" });
    await page.evaluate(() =>
      (window as unknown as { __qz: { useApp: { getState: () => { startMacro: () => void } } } }).__qz.useApp.getState().startMacro(),
    );

    await runPaletteCommand(page, "SIMS depth profile…");
    const panel = page.locator(".qzk-win").filter({ hasText: "SIMS depth profile" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("x: Time (s) · 2 species");

    // 500 nm crater over the 50 s profile (the last point) = 10 nm/s.
    await panel.getByRole("checkbox", { name: "Calibrate / rescale x to depth" }).check();
    await panel.getByRole("textbox", { name: "Crater depth" }).fill("500");
    // Background from the deepest two points (400-500 nm); Si is kept by default.
    await panel.getByRole("checkbox", { name: "Subtract background" }).check();
    await panel.getByRole("textbox", { name: "Background from" }).fill("400");
    await panel.getByRole("textbox", { name: "Background to" }).fill("500");
    await panel.getByRole("checkbox", { name: "Normalize to a reference species" }).check();

    await expect(panel.getByRole("group", { name: "SIMS preview" })).toContainText("Depth: 0 … 500 nm");
    const warnings = panel.getByRole("list", { name: "Transform warnings" });
    await expect(warnings).toContainText("total sputter time taken as the last time point (50 s)");
    await expect(warnings).toContainText("1 value is <= 0 and will not show on a log axis");
    await expect(panel.getByTestId("sims-preview-plot").locator("polyline")).toHaveCount(2);
    expect((await store(page)).datasets).toHaveLength(1);

    await panel.getByRole("button", { name: "Create processed dataset" }).click();
    await waitForDatasetCount(page, 2);
    await expect(panel).toHaveCount(0);

    const after = await store(page);
    const out = after.datasets.find((d) => d.name === "sims-time-profile (SIMS processed)")!;
    expect(out.data.time).toEqual([0, 100, 200, 300, 400, 500]);
    const b = out.data.values.map((r) => r[0] as number);
    [0.0085, 0.0385, 0.04925, 0.00925, 0.00025, -0.00025].forEach((v, i) => expect(b[i]).toBeCloseTo(v, 12));
    expect(out.data.values.map((r) => r[1])).toEqual([10000, 10000, 20000, 20000, 20000, 20000]);
    expect(out.data.units).toEqual(["ratio to Si", "c/s"]);
    const stages = out.data.metadata.sims_processing as Record<string, unknown>[];
    expect(stages.map((s) => s.stage)).toEqual(["calibration", "background", "normalization"]);
    expect(stages[0]).toMatchObject({ method: "crater", sputter_rate_nm_per_s: 10, total_time_assumed: true });
    expect(stages[1]).toMatchObject({ levels: { B: 15 }, unchanged: ["Si"] });
    expect(out.data.metadata).toMatchObject({ x_column_unit: "nm", worksheet_transform: "sims", sims_source: { name: "sims-time-profile.csv" } });
    expect(after.macroSteps.map((s) => [s.kind, s.params.op])).toEqual([["transform", "sims"]]);

    // The Library marks it as derived from its source.
    await expect(page.locator(".qzk-library").getByTitle(/Derived worksheet — source: sims-time-profile\.csv/)).toBeVisible();

    await page.evaluate(() =>
      (window as unknown as { __qz: { useApp: { getState: () => { undo: () => void } } } }).__qz.useApp.getState().undo(),
    );
    await waitForDatasetCount(page, 1);
  });
});
