// UX audit 7, lane UX-H: one export view with a real preview. Plot ▸ Build &
// export ▸ Export figure… opens the Publication preview (not the old
// preview-less dialog), and at 1440 × 900 its picture is at least 600 px wide,
// at the figure's true aspect, with named presets and a format control that
// offers only what the backend renders. Set QZ_UXH_SHOT=<dir> to also save a
// screenshot of the view.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

test("Plot ▸ Export figure… opens the large true-aspect preview", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 1);

  await page.getByRole("menuitem", { name: "Plot" }).click();
  await page.getByRole("menuitem", { name: "Build & export" }).hover();
  const hitmap = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/export/figure-hitmap");
  await page.getByRole("menuitem", { name: "Export figure…", exact: true }).click();
  expect((await hitmap).ok()).toBe(true);

  const view = page.locator(".qzk-win").filter({ has: page.getByText(/^Publication preview/) });
  const frame = view.getByTestId("figure-preview-frame");
  await expect(frame).toBeVisible();
  const img = view.getByAltText("figure preview");
  await expect(img).toBeVisible();
  const box = await img.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(600);
  // True aspect: the default preset is 15.24 × 10.16 cm (3:2).
  expect(box!.width / box!.height).toBeCloseTo(1.5, 1);
  await expect(view.getByLabel("Figure size")).toHaveText(/15\.2 × 10\.2 cm/);

  const formats = view.getByRole("radiogroup", { name: "Figure format" }).getByRole("radio");
  await expect(formats).toHaveText(["PDF", "SVG", "PNG", "TIFF", "EPS"]);
  await expect(view.getByRole("combobox", { name: "Figure style" }).locator("option", { hasText: "APS · single column · 8.6 × 6.5 cm" })).toHaveCount(1);
  // Vector formats need no DPI; raster ones show it.
  await expect(view.getByRole("textbox", { name: "Figure DPI (raster)" })).toHaveCount(0);
  await view.getByRole("radio", { name: "PNG" }).click();
  await expect(view.getByRole("textbox", { name: "Figure DPI (raster)" })).toBeVisible();
  await view.getByRole("radio", { name: "PDF" }).click();

  // 100 %: the figure at its physical size (96 CSS px per inch).
  await view.getByRole("radio", { name: "Actual size (100 %)" }).click();
  await expect.poll(async () => (await img.boundingBox())!.width).toBeCloseTo((15.24 / 2.54) * 96, -1);
  await view.getByRole("radio", { name: "Fit" }).click();

  const shotDir = process.env.QZ_UXH_SHOT;
  if (shotDir) {
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${shotDir}/export_view_1440.png` });
    await view.getByRole("combobox", { name: "Figure style" }).selectOption("aps");
    await expect(view.getByLabel("Figure size")).toHaveText(/8\.6 × 6\.5 cm/);
    await page.screenshot({ path: `${shotDir}/export_view_1440_aps.png` });
    await view.getByRole("radio", { name: "Actual size (100 %)" }).click();
    await page.screenshot({ path: `${shotDir}/export_view_1440_aps_100.png` });
  }
});
