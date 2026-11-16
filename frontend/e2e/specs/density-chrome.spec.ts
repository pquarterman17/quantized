// UX8-I (UX audit 8 #10): density and chrome. Ten imported CSVs fit a 900 px
// Library at <= ~36 px per dataset (a one-sheet workbook is ONE row and the
// add-tag "+" no longer takes a line), and the plot dock is a single Tab stop.

import { expect, test } from "@playwright/test";

import { gotoApp, waitForDatasetCount } from "../utils/harness";

const csv = (i: number): { name: string; mimeType: string; buffer: Buffer } => ({
  name: `loop${i}.csv`,
  mimeType: "text/csv",
  buffer: Buffer.from(`H,M\n${[0, 1, 2, 3, 4, 5].map((k) => `${k},${k * (i + 1)}`).join("\n")}\n`),
});

test("ten datasets fit the 900 px Library and the plot dock is one Tab stop", async ({ page }) => {
  await gotoApp(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import data" }).first().click();
  await (await chooser).setFiles(Array.from({ length: 10 }, (_, i) => csv(i)));
  await waitForDatasetCount(page, 10);

  // One row per dataset: no workbook header above a lone sheet.
  await expect(page.locator('[data-lib-row^="workbook:"]')).toHaveCount(0);
  const rows = page.locator("[data-ds-id]");
  const boxes = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  const pitch = (boxes[9].top - boxes[0].top) / 9;
  expect(pitch).toBeLessThanOrEqual(38); // target <= 36 px incl. the row gap
  const lib = await page.locator(".qzk-library").boundingBox();
  const last = boxes[9];
  expect(last.bottom).toBeLessThanOrEqual((lib?.y ?? 0) + (lib?.height ?? 0)); // all ten visible without scrolling

  // The dock: exactly one tabbable button, arrows move within it.
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
  const dock = page.getByRole("toolbar", { name: "Plot tools" });
  await expect(dock).toBeVisible();
  const tabbable = dock.locator("button.qzk-tool-btn:not([tabindex='-1'])");
  await expect(tabbable).toHaveCount(1);
  await tabbable.focus();
  await page.keyboard.press("ArrowRight");
  await expect(dock.locator("button.qzk-tool-btn:focus")).toHaveCount(1);
  await expect(tabbable).toHaveCount(1);
});
