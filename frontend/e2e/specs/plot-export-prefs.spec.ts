// PREFS_AUDIT lane 2: change the Plot and Export preferences in the real
// dialog, create a NEW plot, check it on screen, export it, reload.
//
// Canvas and export agree: the same prefs reach the uPlot canvas (marker size,
// tick direction, legend position, grid) and the /api/export/figure request
// the Publication preview sends (marker_size, x_fmt.ticks, legend loc, grid,
// transparent, svg_text_as_paths, format). Defaults are provisional, owner to
// confirm.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { exportFromView } from "../utils/exportView";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { fixturePath } from "../utils/fixtures";

type Body = {
  fmt?: string;
  transparent?: boolean;
  svg_text_as_paths?: boolean;
  x_fmt?: { ticks?: string };
  overrides?: { grid?: boolean; legend?: { loc?: string }; font_size?: number };
  series_styles?: ({ marker_size?: number } | null)[];
};

test("Plot and Export prefs reach a new plot, its export, and survive a reload", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Control+,");
  const dlg = page.getByRole("dialog", { name: "Preferences" });
  await expect(dlg).toBeVisible();

  // Plot tab: palette mirror, marker size, font size, tick direction, legend, grid.
  await dlg.getByRole("tab", { name: "Plot" }).click();
  await dlg.getByLabel("Series palette").selectOption("okabe-ito");
  await dlg.getByLabel("Tick direction").selectOption("in");
  await dlg.getByLabel("Legend position").selectOption("sw");
  await dlg.getByLabel("Marker size").fill("9");
  await dlg.getByLabel("Font size").fill("14");
  await dlg.getByLabel("Grid lines").click(); // on -> off
  await dlg.getByLabel("Default trace").selectOption("Scatter");

  // Export tab: SVG, text as paths, transparent.
  await dlg.getByRole("tab", { name: "Export" }).click();
  await dlg.getByLabel("Default export format").selectOption("svg");
  await dlg.getByLabel("Export text as paths").click();
  await dlg.getByLabel("Transparent export background").click();
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);

  // A NEW plot takes the prefs.
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 1);
  const view = await page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => Record<string, unknown> } } }).__qz.useApp.getState();
    return { grid: s.showGrid, legend: s.legendPos, x: s.xFmt, palette: s.palette };
  });
  expect(view).toMatchObject({ grid: false, legend: "sw", x: { ticks: "in" }, palette: "okabe-ito" });

  await expect(page.locator(".u-over").first()).toBeVisible(); // the canvas is up; the unit tests pin its drawn marker size

  // Export: format preset to SVG, and every pref rides the request.
  const { body } = await exportFromView<Body>(page, "svg");
  expect(body.fmt).toBe("svg");
  expect(body.transparent).toBe(true);
  expect(body.x_fmt?.ticks).toBe("in");
  expect(body.overrides?.grid).toBe(false);
  expect(body.overrides?.legend?.loc).toBe("lower left");
  expect(body.overrides?.font_size).toBeCloseTo((14 * 10) / 12);
  expect((body.series_styles ?? []).some((s) => s?.marker_size === 9)).toBe(true);

  // Reload: the prefs are still there.
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __qz?: unknown }).__qz));
  await page.keyboard.press("Control+,");
  const again = page.getByRole("dialog", { name: "Preferences" });
  await again.getByRole("tab", { name: "Plot" }).click();
  await expect(again.getByLabel("Tick direction")).toHaveValue("in");
  await expect(again.getByLabel("Legend position")).toHaveValue("sw");
  await expect(again.getByLabel("Marker size")).toHaveValue("9");
  await again.getByRole("tab", { name: "Export" }).click();
  await expect(again.getByLabel("Default export format")).toHaveValue("svg");
});

test("defaults leave a new plot and its export request unchanged", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 1);
  const { body } = await exportFromView<Body>(page, "pdf");
  expect(body.fmt).toBe("pdf");
  expect(body.transparent).not.toBe(true); // the preview sends an explicit false today
  expect(body.svg_text_as_paths).toBeUndefined();
  expect(body.x_fmt?.ticks).toBeUndefined();
  expect(body.overrides?.font_size).toBeUndefined();
  expect(body.overrides?.legend?.loc).not.toBe("lower left");
});
