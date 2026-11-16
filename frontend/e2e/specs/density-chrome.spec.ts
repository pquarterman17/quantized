// UX8-I (UX audit 8 #10): density and chrome. A sheet row is one line (<= 38 px)
// because the add-tag "+" is a hover overlay that no longer takes a line, and
// the plot dock is a single Tab stop. (A one-sheet workbook keeps its header
// row: it carries workbook actions and drag-to-folder.)

import { expect, test } from "@playwright/test";

import { gotoApp, waitForDatasetCount } from "../utils/harness";

const csv = (i: number): { name: string; mimeType: string; buffer: Buffer } => ({
  name: `loop${i}.csv`,
  mimeType: "text/csv",
  buffer: Buffer.from(`H,M\n${[0, 1, 2, 3, 4, 5].map((k) => `${k},${k * (i + 1)}`).join("\n")}\n`),
});

test("sheet rows are one line in the Library and the plot dock is one Tab stop", async ({ page }) => {
  await gotoApp(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import data" }).first().click();
  await (await chooser).setFiles(Array.from({ length: 10 }, (_, i) => csv(i)));
  await waitForDatasetCount(page, 10);

  // Sheet rows are one line each: the add-tag "+" is a hover overlay, not a
  // second line, and the counts are visually hidden in a narrow panel.
  const rows = page.locator("[data-ds-id]");
  const boxes = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  const pitch = (boxes[9].top - boxes[0].top) / 9;
  console.log(`DENSITY dataset pitch=${pitch.toFixed(1)}px sheet-row height=${boxes[0].height.toFixed(1)}px`);
  // Each sheet row is a single line; adjacent sheet rows may be separated by their workbook header.
  for (const b of boxes) expect(b.height).toBeLessThanOrEqual(38);
  const wb = await page.locator('[data-lib-row^="workbook:"]').count();
  const lib = await page.locator(".qzk-library").boundingBox();
  const libH = lib?.height ?? 0;
  const dsPerPanel = libH / pitch;
  // One dataset = workbook header (~22 px) + one-line sheet row (~34 px).
  expect(pitch).toBeLessThanOrEqual(58);
  console.log(`DENSITY workbooks=${wb} libraryHeight=${libH} datasets-per-panel=${dsPerPanel.toFixed(1)}`);

  // Hover tag "+" overlays the row: it never adds a line, and never covers the preview toggle.
  const row0 = rows.first();
  await row0.hover();
  const plus = row0.locator(".qzk-ds-tags-resting button").first();
  await expect(plus).toBeVisible();
  const plusBox = await plus.boundingBox();
  const toggleBox = await row0.getByRole("button", { name: /preview/i }).first().boundingBox();
  expect(plusBox && toggleBox && (plusBox.x >= toggleBox.x + toggleBox.width || plusBox.x + plusBox.width <= toggleBox.x)).toBe(true);
  expect((await row0.boundingBox())?.height).toBeLessThanOrEqual(38);

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
