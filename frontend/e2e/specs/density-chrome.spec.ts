// UX8-I (UX audit 8 #10): density and chrome. A workbook holding one sheet and
// nothing else is ONE Library row (<= 38 px; the add-tag "+" is a hover overlay),
// so ten imported CSVs fit the 900 px window without scrolling. That row ACTS AS
// THE WORKBOOK for workbook-level things: its grip drags the workbook onto a
// folder and its menu renames the workbook. The plot dock is a single Tab stop.

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
  // Each import is ONE line: no workbook header row sits between the sheets.
  for (const b of boxes) expect(b.height).toBeLessThanOrEqual(38);
  await expect(page.locator('[data-lib-row^="workbook:"]')).toHaveCount(0);
  const lib = await page.locator(".qzk-library").boundingBox();
  const libH = lib?.height ?? 0;
  expect(pitch).toBeLessThanOrEqual(38);
  console.log(`DENSITY libraryHeight=${libH} datasets-per-panel=${(libH / pitch).toFixed(1)}`);
  // All ten rows sit inside the visible Library (no scrolling) at the 900 px window.
  expect(page.viewportSize()?.height).toBe(900);
  expect(boxes[9].bottom).toBeLessThanOrEqual((lib?.y ?? 0) + libH);
  expect(boxes[0].top).toBeGreaterThanOrEqual(lib?.y ?? 0);

  // The row is the workbook: its grip drags the WORKBOOK onto a folder ...
  await page.getByTitle("New folder", { exact: true }).click();
  const folderHead = page.locator(".qzk-folder-head:not(.qzk-workbook-row)").first();
  await expect(folderHead).toBeVisible();
  await page.locator('[data-ds-id]', { hasText: "loop3" }).locator(".qzk-drag-handle").dragTo(folderHead);
  const state = (): Promise<{ folderId?: string; wbFolder?: string; wbName?: string; dsName?: string; folders: number }> =>
    page.evaluate(() => {
      const st = (window as unknown as { __qz: { useApp: { getState: () => { workbooks: { id: string; name: string; folderId?: string }[]; datasets: { name: string; workbookId?: string }[]; folders: { id: string }[] } } } }).__qz.useApp.getState();
      const d = st.datasets.find((x) => x.name === "loop3.csv");
      const w = st.workbooks.find((x) => x.id === d?.workbookId);
      return { folderId: st.folders[0]?.id, wbFolder: w?.folderId, wbName: w?.name, dsName: d?.name, folders: st.folders.length };
    });
  await expect.poll(async () => (await state()).wbFolder).toBe((await state()).folderId);
  expect((await state()).wbFolder).toBeTruthy();

  // ... and its menu's "Rename…" renames the workbook and the sheet together.
  await page.locator("[data-ds-id]", { hasText: "loop5" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…", exact: true }).click();
  const input = page.locator("input.qzk-ds-name");
  await input.fill("Renamed loop");
  await input.press("Enter");
  await expect.poll(async () => page.evaluate(() => {
    const st = (window as unknown as { __qz: { useApp: { getState: () => { workbooks: { name: string }[]; datasets: { name: string }[] } } } }).__qz.useApp.getState();
    return [st.workbooks.some((w) => w.name === "Renamed loop"), st.datasets.some((d) => d.name === "Renamed loop")];
  })).toEqual([true, true]);

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
