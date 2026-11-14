import { expect, test } from "@playwright/test";

import { gotoApp } from "../utils/harness";

// Re-audit #10: at a 1360 px window (the default 210 px Library) Origin book
// names truncated beside their squeezed "Origin book" chip ("decay…",
// "twocha…", "Ori…"), and a graph row's hover strip left its name a couple of
// letters ("N.."). In a narrow Library the chip yields to the name, and the
// revealed strip takes the place of the row's secondary text, not its name.
test("book names stay whole and a hovered graph keeps its name at 1360 px @core", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await gotoApp(page);
  await page.evaluate(() => {
    const useApp = (window as unknown as { __qz: { useApp: { setState: (state: object) => void } } }).__qz.useApp;
    const sheet = (id: string, workbookId: string, book: string) => ({
      id, workbookId, name: `journey:${book}`,
      data: { time: [0, 1], values: [[1], [2]], labels: ["Signal"], units: [""], metadata: { origin_book: book } },
    });
    useApp.setState({
      // As an Origin import lays them out: the project's folder, its books inside.
      folders: [{ id: "f1", name: "journey", parentId: null, order: 0 }],
      expandedFolders: ["f1"],
      workbooks: [
        { id: "w1", name: "decayerr", originBook: "decayerr", folderId: "f1" },
        { id: "w2", name: "twochannel", originBook: "twochannel", folderId: "f1" },
      ],
      datasets: [sheet("d1", "w1", "decayerr"), sheet("d2", "w2", "twochannel")],
      originFigures: [{
        id: "g1", stem: "journey", datasetId: "d1", siblingIds: ["d1"],
        figure: { name: "NoriginTitle", x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false, n_curves: 2, annotations: [] },
      }],
      expandedWorkbookIds: ["w1", "w2"],
      librarySelection: null,
      selectedIds: [],
    });
  });

  for (const name of ["decayerr", "twochannel"]) {
    const el = page.locator(".qzk-workbook-row .qzk-group-name", { hasText: name }).first();
    await expect(el).toBeVisible();
    expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), `"${name}" is not truncated`).toBe(true);
  }

  const row = page.locator(".qzk-fig-row-tree").first();
  const name = row.locator(".qzk-fig-name");
  await expect(name).toBeVisible();
  const atRest = await name.evaluate((e) => e.getBoundingClientRect().width);
  await row.hover();
  await expect(row.locator(".qzk-origin-figure-actions")).toBeVisible();
  const onHover = await name.evaluate((e) => e.getBoundingClientRect().width);
  expect(onHover, "the revealed strip does not squeeze the graph's name").toBeGreaterThanOrEqual(atRest - 1);
  expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), "the graph name is whole on hover").toBe(true);
});
