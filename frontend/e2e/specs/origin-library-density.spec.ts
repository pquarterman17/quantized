import { expect, test } from "@playwright/test";

import { gotoApp } from "../utils/harness";

test("dense recovered Origin graphs stay inside the Library and reveal one action strip @core", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const useApp = (window as unknown as {
      __qz: { useApp: { setState: (state: object) => void } };
    }).__qz.useApp;
    useApp.setState({
      workbooks: [{ id: "w1", name: "PNR project", originBook: "PNR" }],
      datasets: [{
        id: "d1",
        workbookId: "w1",
        name: "PNR:sheet",
        data: {
          time: [0, 1], values: [[1], [2]], labels: ["Reflectivity"], units: [""],
          metadata: { origin_book: "PNR" },
        },
      }],
      originFigures: [...Array.from({ length: 24 }, (_, index) => ({
        id: `g${index}`,
        stem: `PNR very long recovered graph ${index}`,
        datasetId: "d1",
        siblingIds: ["d1"],
        figure: {
          name: `Graph ${index} — reflectometry comparison with a deliberately long title`,
          x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: true,
          n_curves: 4, annotations: [],
        },
      })), {
        id: "unresolved", stem: "Missing source graph with a readable title",
        datasetId: null, siblingIds: ["d1"],
        figure: {
          name: "Unresolved reflectometry comparison", source_hint: "MissingBook",
          x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: true,
          n_curves: 1, annotations: [], curves: [{ book: "MissingBook", x: "A", y: "B" }],
        },
      }],
      expandedWorkbookIds: ["w1"],
      librarySelection: null,
      selectedIds: [],
    });
  });

  const library = page.locator(".qzk-library");
  const rows = page.locator(".qzk-fig-row-tree");
  await expect(rows).toHaveCount(25);
  expect(await library.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  const actions = page.locator(".qzk-origin-figure-actions");
  await expect(actions.first()).toHaveCSS("visibility", "hidden");
  await rows.first().hover();
  await expect(actions.first()).toHaveCSS("visibility", "visible");
  await expect(actions.nth(1)).toHaveCSS("visibility", "hidden");

  await rows.first().locator(".qzk-fig-item").focus();
  await expect(actions.first()).toHaveCSS("visibility", "visible");
  await page.keyboard.press("Tab");
  await expect(actions.first().getByTitle("Open in a new graph window")).toBeFocused();

  const unresolved = rows.last();
  const unresolvedItem = unresolved.locator(".qzk-fig-item");
  const unresolvedActions = unresolved.locator(".qzk-origin-figure-actions");
  await expect(unresolvedActions).toHaveCSS("position", "static");
  await expect(unresolvedActions.getByRole("combobox", { name: /Choose source workbook/ })).toBeVisible();
  const [itemBox, actionBox] = await Promise.all([unresolvedItem.boundingBox(), unresolvedActions.boundingBox()]);
  expect(itemBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(itemBox!.width).toBeGreaterThan(20);
  expect(itemBox!.x + itemBox!.width).toBeLessThanOrEqual(actionBox!.x + 1);
});
