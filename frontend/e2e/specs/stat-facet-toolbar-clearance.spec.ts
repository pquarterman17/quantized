// Acceptance 14 C1: switching a Box plot to "facet by" must leave the facet grid below the floating tool bar
// (the grid used to take over the flat plot's div and keep an old top offset, under the bar).
// Not `@core`: layout geometry, no canvas hit-testing.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

test("the facet grid starts below the wrapped tool bar", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("lot-wafer-thickness.csv"));
  await waitForDatasetCount(page, 1);
  await runPaletteCommand(page, "Toggle statistics view");
  await page.locator("label", { hasText: "facet by" }).locator("select").selectOption({ label: "Lot" });

  const bar = page.locator(".qzk-float-tools");
  const grid = page.locator(".qzk-stage > div[style*='display: grid']");
  await expect(grid).toHaveCount(1);
  await expect(async () => {
    const b = await bar.boundingBox();
    const g = await grid.boundingBox();
    expect(b && g).toBeTruthy();
    expect(g!.y).toBeGreaterThanOrEqual(b!.y + b!.height - 1);
  }).toPass();
});
