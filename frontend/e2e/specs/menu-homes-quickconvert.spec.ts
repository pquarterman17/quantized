// UX audit 12: commands that used to be palette-only now have a menu home
// (File > Export, Plot > Axes, Analyze > Normalize), each inside a flyout so the
// root menus keep their compact height; and Quick Convert counts only the files
// it can convert.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, launchPath, waitForDatasetCount } from "../utils/harness";
import { clickMenuPath } from "../utils/menu";

test("Export PDF / SVG / PNG, Log scale and Normalize are reachable from the menus", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
  await waitForDatasetCount(page, 1);
  await page.locator("[data-ds-id]").first().click();

  for (const [menu, flyout, items] of [
    ["File", "Export", ["Export PDF…", "Export SVG…", "Export PNG…"]],
    ["Plot", "Axes", ["Log X scale", "Log Y scale"]],
    ["Analyze", "Normalize", ["Normalize · peak = 1", "Normalize · 0–1", "Normalize · Z-score"]],
  ] as const) {
    await page.getByRole("menuitem", { name: menu, exact: true }).click();
    const root = page.getByRole("menu").first();
    const box = (await root.locator("xpath=..").boundingBox())!;
    expect(box.height, `${menu} root stays compact`).toBeLessThan(360);
    await page.getByRole("menuitem", { name: flyout, exact: true }).hover();
    for (const name of items) await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  }

  // Log Y changes the scale through the menu.
  await page.getByRole("menuitem", { name: "Plot", exact: true }).click();
  await clickMenuPath(page, "Axes", "Log Y scale");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { yScale: string } } } }).__qz.useApp.getState().yScale))
    .toBe("log");
});

test("Quick Convert counts only convertible files and says how many are skipped", async ({ page }) => {
  await page.goto(launchPath("harness").replace("/?", "/convert?"));
  await expect(page.getByRole("group", { name: "Add files to convert" })).toBeVisible();
  await page.getByTestId("qc-upload").setInputFiles([fixturePath("two-channel.csv"), fixturePath("unknown-type.qzzz")]);
  await expect(page.getByRole("button", { name: "Convert 1 file" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/1 file can’t be converted and will be skipped/)).toBeVisible();
});
