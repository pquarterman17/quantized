// Acceptance pass 5 (C3, C12, u8) in a real browser, in the window layout:
// - Mirror column… on the sheet the Data window already shows adds NO second worksheet
//   window ("dataset-b.csv (2)"), and "Plot | Data side by side" twice leaves one Data window;
// - Go to Source opens the source's window with the mirrored column SCROLLED INTO VIEW (jsdom has
//   no layout, so only a browser can say the column is on screen);
// - right-click on the row-number gutter offers the selected-row actions, Mask row still first.
// Not `@core`: DOM and layout, no canvas hit-testing.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

test.use({ viewport: { width: 1900, height: 1100 } });

test("mirror column: no duplicate window, Go to Source scrolls the column into view, row menu acts on the selection", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("six-channel.csv"));
  await waitForDatasetCount(page, 1);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-b.csv"));
  await waitForDatasetCount(page, 2);

  const preset = page.getByRole("button", { name: /Plot \| Data side by side/ });
  await preset.click();
  await preset.click();
  const dataWindow = page.locator('[data-wl-window="data"]');
  await expect(dataWindow).toHaveCount(1);
  const windows = () => page.locator("[data-wl-window^='plot:']");
  const plotWindows = await windows().count();

  await runPaletteCommand(page, "Mirror column");
  const dialog = page.getByRole("dialog").first();
  await dialog.getByRole("button", { name: "Next" }).click();
  await dialog.locator("select").selectOption({ label: "F — Zeta" });
  await dialog.getByRole("button", { name: "Mirror" }).click();
  await expect(page.getByText(/mirrored six-channel\.csv › Zeta as/)).toBeVisible(); // the source column by its label
  await expect(dataWindow).toHaveCount(1);
  await expect(windows()).toHaveCount(plotWindows); // no "(2)" worksheet window for the sheet Data shows

  // The mirror's header, Go to Source.
  await dataWindow.hover();
  await page.mouse.wheel(900, 0);
  await dataWindow.locator("[role=columnheader]").filter({ hasText: "Zeta" }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: /Go to Source/ }).click();
  const source = page.locator("[data-wl-window^='plot:']").filter({ has: page.locator("[role=grid]") }).last();
  const selected = source.locator("[role=columnheader][data-col='5']");
  await expect(selected).toBeVisible();
  const visible = await selected.evaluate((h) => {
    const grid = h.closest("[role=grid]") as HTMLElement;
    const scroller = [grid, ...grid.querySelectorAll<HTMLElement>("*")].find((e) => e.scrollWidth > e.clientWidth + 5 && getComputedStyle(e).overflowX !== "visible") ?? grid;
    const box = scroller.getBoundingClientRect();
    const pinned = [...grid.querySelectorAll<HTMLElement>("[role=rowheader], [role=gridcell]")].slice(0, 2).reduce((w, e) => Math.max(w, e.getBoundingClientRect().right), box.left);
    const r = h.getBoundingClientRect();
    return { left: r.left, right: r.right, minLeft: pinned - 1, maxRight: box.right + 1 };
  });
  expect(visible.right).toBeLessThanOrEqual(visible.maxRight);
  expect(visible.left).toBeGreaterThanOrEqual(visible.minLeft);

  // Row gutter right-click in the Data window: Mask row first, then the selected-row actions.
  const gutter = (n: number) => dataWindow.locator("[role=rowheader]").filter({ hasText: new RegExp(`^${n}$`) });
  await gutter(2).click();
  await gutter(4).click({ modifiers: ["Shift"] });
  await gutter(3).click({ button: "right" });
  const menu = page.getByRole("menu").last();
  const items = (await menu.getByRole("menuitem").allInnerTexts()).filter((t) => t.trim() !== "");
  expect(items[0]).toBe("Mask row");
  for (const label of ["Exclude", "Keep only", "Use as row range", "Deselect"]) expect(items).toContain(label);
  await menu.getByRole("menuitem", { name: "Exclude", exact: true }).click();
  for (const n of [2, 3, 4]) await expect(gutter(n).locator("xpath=..")).toHaveCSS("opacity", "0.4"); // the selected rows are now excluded
});
