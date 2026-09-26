// Resample / align (PRIMARY_SOFTWARE_AUDIT_PLAN P2.5, "previewed
// align/interpolate"), end to end against the real backend's resample route:
// open the workshop, see the live preview (overlay + counts + the
// out-of-range warning) while NOTHING is created yet, commit, and find the
// derived dataset with its provenance and a recorded `resample` step.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

type Store = { getState: () => Record<string, unknown> };
const store = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: Store } }).__qz.useApp.getState() as {
      datasets: { name: string; data: { time: number[]; values: (number | null)[][]; metadata: Record<string, unknown> } }[];
      macroSteps: { kind: string; params: Record<string, unknown> }[];
    };
    return { datasets: s.datasets, macroSteps: s.macroSteps };
  });

test.describe("Resample / align workshop (P2.5)", () => {
  test("open → live preview → create → derived dataset with provenance and a recorded step", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);
    await page.evaluate(() =>
      ((window as unknown as { __qz: { useApp: { getState: () => { startMacro: () => void } } } }).__qz.useApp
        .getState()
        .startMacro()),
    );

    await runPaletteCommand(page, "Resample / align to a common grid…");
    const panel = page.locator(".qzk-win").filter({ hasText: "Resample / align" });
    await expect(panel).toBeVisible();

    // An explicit grid reaching past the data: -5:5:25 over x = 0..20.
    await panel.getByRole("combobox", { name: "Target grid" }).selectOption("range");
    await panel.getByRole("textbox", { name: "Start" }).fill("-5");
    await panel.getByRole("textbox", { name: "Step" }).fill("5");
    await panel.getByRole("textbox", { name: "Stop" }).fill("25");

    const results = panel.getByRole("list", { name: "Resample results" });
    await expect(results).toContainText("linear-ramp.csv: 21 rows → 7 rows");
    await expect(panel.getByRole("list", { name: "Transform warnings" })).toContainText(
      "2 of 7 target points lie outside the source x-range [0, 20] and are left blank (no extrapolation)",
    );
    // Five in-range points are marked on the overlay; the preview created nothing.
    await expect(panel.getByTestId("resample-preview-plot").locator("[data-resampled-point]")).toHaveCount(5);
    expect((await store(page)).datasets).toHaveLength(1);

    await panel.getByRole("button", { name: "Create resampled dataset" }).click();
    await waitForDatasetCount(page, 2);
    await expect(panel).toHaveCount(0);

    const after = await store(page);
    const out = after.datasets.find((d) => d.name === "linear-ramp (resampled)")!;
    expect(out.data.time).toEqual([-5, 0, 5, 10, 15, 20, 25]);
    expect(out.data.values.map((r) => r[0])).toEqual([null, 0, 5, 10, 15, 20, null]);
    expect(out.data.metadata).toMatchObject({
      worksheet_transform: "resample",
      resample_of: "linear-ramp.csv",
      resampled: true,
      resampleMethod: "linear",
    });
    expect((out.data.metadata.transform_warnings as string[])[0]).toContain("left blank");
    expect(after.macroSteps.map((s) => [s.kind, s.params.op, s.params.mode])).toEqual([["transform", "resample", "range"]]);
  });
});
