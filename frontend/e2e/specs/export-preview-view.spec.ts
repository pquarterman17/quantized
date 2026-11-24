// UX audit 7, lane UX-H: one export view with a real preview. Plot ▸ Build &
// export ▸ Export figure… opens the Publication preview (not the old
// preview-less dialog), and at 1440 × 900 its picture is at least 600 px wide,
// at the figure's true aspect, with named presets and a format control that
// offers only what the backend renders — and its one primary Export button
// downloads the file shown. Set QZ_UXH_SHOT=<dir> to also save screenshots.

import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { exportView } from "../utils/exportView";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { clickMenuPath } from "../utils/menu";

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

test("File ▸ Export ▸ Export figure… opens the large true-aspect preview and exports what it shows", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 1);

  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  const hitmap = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/export/figure-hitmap");
  await clickMenuPath(page, "Export", "Export figure…");
  expect((await hitmap).ok()).toBe(true);

  const view = exportView(page);
  await expect(view.getByTestId("figure-preview-frame")).toBeVisible();
  const img = view.getByAltText("figure preview");
  await expect(img).toBeVisible();
  const box = await img.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(600);
  // True aspect: the default preset is 15.24 × 10.16 cm (3:2).
  expect(box!.width / box!.height).toBeCloseTo(1.5, 1);
  await expect(view.getByRole("status", { name: "Figure size" })).toHaveText(/15\.2 × 10\.2 cm/);

  const formats = view.getByRole("radiogroup", { name: "Format" }).getByRole("radio");
  await expect(formats).toHaveText(["PDF", "SVG", "PNG", "TIFF", "EPS"]);
  const preset = view.getByRole("combobox", { name: "Preset" });
  await expect(preset.locator("option", { hasText: "APS · single column · 8.6 × 6.5 cm" })).toHaveCount(1);
  // Vector formats need no DPI; raster ones show it, with the pixel size.
  await expect(view.getByRole("textbox", { name: "Resolution (dpi)" })).toHaveCount(0);
  await view.getByRole("radio", { name: "PNG" }).click();
  await expect(view.getByRole("textbox", { name: "Resolution (dpi)" })).toBeVisible();
  await expect(view.getByRole("status", { name: "Raster size" })).toHaveText(/\d+ × \d+ px/);
  await view.getByRole("radio", { name: "PDF" }).click();

  // 100 % (screen): the figure at 96 CSS px per inch.
  await view.getByRole("radio", { name: "100 % (screen)" }).click();
  await expect.poll(async () => (await img.boundingBox())!.width).toBeCloseTo((15.24 / 2.54) * 96, -1);
  await view.getByRole("radio", { name: "Fit" }).click();

  const shotDir = process.env.QZ_UXH_SHOT;
  if (shotDir) {
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${shotDir}/export_view_1440.png` });
  }

  // A window resized short still shows its action row (it sticks to the
  // window's bottom edge rather than scrolling away under the preview).
  await page.evaluate(() => {
    const app = (window as unknown as { __qz: { useApp: { getState: () => {
      toolWindowLayout: Record<string, { x: number; y: number; width: number; height: number | null; collapsed: boolean } | undefined>;
      setToolWindowLayout: (id: string, l: { x: number; y: number; width: number; height: number | null; collapsed: boolean }) => void;
    } } } }).__qz.useApp;
    const layout = app.getState().toolWindowLayout.figurebuilder ?? { x: 240, y: 90, width: 1120, height: null, collapsed: false };
    app.getState().setToolWindowLayout("figurebuilder", { ...layout, height: 600 });
  });
  await expect(view.getByRole("button", { name: "Export PDF…", exact: true })).toBeInViewport({ ratio: 1 });

  // ONE primary action, and it downloads the figure in the chosen format.
  await preset.selectOption("aps");
  await expect(view.getByRole("status", { name: "Figure size" })).toHaveText(/8\.6 × 6\.5 cm/);
  if (shotDir) await page.screenshot({ path: `${shotDir}/export_view_1440_aps.png` });
  const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/export/figure");
  const download = page.waitForEvent("download");
  await view.getByRole("button", { name: "Export PDF…", exact: true }).click();
  const body = (await request).postDataJSON() as { fmt: string; style: string };
  expect(body).toMatchObject({ fmt: "pdf", style: "aps" });
  const file = await download;
  expect(file.suggestedFilename()).toBe("two-channel.pdf");
  expect((await readFile((await file.path())!)).subarray(0, 5).toString("ascii")).toBe("%PDF-");
  // Output choices plus an export are not unpublished work: Close asks nothing.
  await view.getByRole("button", { name: "Close", exact: true }).click();
  await expect(view).toHaveCount(0);
  // Confirms may be `alertdialog` (UX10-D) or `dialog`: check both so this
  // negative assertion cannot pass vacuously on a role change.
  await expect(
    page.getByRole("dialog", { name: /Discard/ }).or(page.getByRole("alertdialog", { name: /Discard/ })),
  ).toHaveCount(0);
});
