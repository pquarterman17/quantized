// Axis dialog — reverse Y and a secondary (reciprocal) top X axis (origin
// gap audit 2 #5, #659), end to end against the real backend: both settings
// land on the live view AND on a real SVG export, screen and export sharing
// one algorithm (calc/axis_top.py <-> lib/axisTop.ts). See
// docs/theory/analysis.md for the reciprocal-axis formula and its Arrhenius
// (1/T) reading.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface TopAxis {
  kind?: string;
  factor?: number;
  title?: string;
}
interface AxisFmt {
  reverse?: boolean;
  top?: TopAxis;
}
type QzWindow = {
  __qz: { useApp: { getState: () => { xFmt?: AxisFmt; yFmt?: AxisFmt } } };
};
const axisFmt = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState();
    return { xTop: s.xFmt?.top ?? null, yReverse: s.yFmt?.reverse ?? false };
  });

interface FigureBody {
  x_fmt?: { top?: TopAxis };
  y_fmt?: { reverse?: boolean };
}

const TOP_TITLE = "Top 1 over T";

test("Axis dialog: a reciprocal top axis and a reversed Y axis, matched on screen and in the SVG export", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  // 2theta in [30, 50]: all-positive X, so the reciprocal transform is
  // defined over the whole visible range (no singularity guard engaged).
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-peaks.csv"));
  await waitForDatasetCount(page, 1);

  // ── Top X axis: reciprocal, factor 1000 (the "1000/T" Arrhenius reading) ──
  await runPaletteCommand(page, "Axis…");
  let dialog = page.getByRole("dialog", { name: "Axis" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "X axis Shows" }).selectOption("reciprocal");
  await dialog.getByRole("textbox", { name: "X axis Factor" }).fill("1000");
  await dialog.getByRole("textbox", { name: "X axis Title", exact: true }).fill(TOP_TITLE);
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).not.toBeVisible();

  await expect.poll(() => axisFmt(page)).toMatchObject({
    xTop: { kind: "reciprocal", factor: 1000, title: TOP_TITLE },
  });

  // ── Reverse the Y axis (a separate open: switching tabs mid-edit drops
  //    the OTHER tab's unapplied draft, so each axis is one open + Apply). ──
  await runPaletteCommand(page, "Axis…");
  dialog = page.getByRole("dialog", { name: "Axis" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Y" }).click();
  await dialog.getByRole("checkbox", { name: "Y axis Reverse" }).check();
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).not.toBeVisible();

  await expect.poll(() => axisFmt(page)).toMatchObject({
    xTop: { kind: "reciprocal", factor: 1000, title: TOP_TITLE },
    yReverse: true,
  });

  // ── Export to SVG: the request carries the same axis formats, and the
  //    rendered SVG actually draws the top axis' title text. ──
  await runPaletteCommand(page, "Export figure…");
  const exportDialog = page.getByRole("dialog", { name: "Export figure" });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByLabel("Format").selectOption("svg");
  const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/export/figure");
  const download = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Export", exact: true }).click();
  const body = (await request).postDataJSON() as FigureBody;
  const file = await download;
  const bytes = await (await import("node:fs/promises")).readFile(await file.path());

  expect(body.x_fmt?.top).toMatchObject({ kind: "reciprocal", factor: 1000, title: TOP_TITLE });
  expect(body.y_fmt?.reverse).toBe(true);
  const svg = bytes.toString("utf8");
  expect(svg).toMatch(/<svg[^>]*>/);
  expect(svg).toContain(TOP_TITLE); // the secondary axis' own label, drawn
});
