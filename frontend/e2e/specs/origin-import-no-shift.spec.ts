import { expect, test } from "@playwright/test";

import { gotoApp } from "../utils/harness";

// Re-audit #9 (owner decision): an Origin import must not move the rows that
// were already in the Library. It used to insert the fidelity section and
// the book-family card above the tree (+22 px, then +96 px) and its own
// project folder above every workbook (+176 px), so a double-click aimed at
// a row opened whatever slid under the pointer. The project-wide sections now
// follow the rows, and a new import lands below the existing root rows.
test("existing Library rows do not move when an Origin project arrives @core", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await gotoApp(page);
  const set = (state: object) =>
    page.evaluate((s) => (window as unknown as { __qz: { useApp: { setState: (x: object) => void } } }).__qz.useApp.setState(s), state);
  const csv = (id: string, name: string) => ({
    id, workbookId: `wb-${id}`, name,
    data: { time: [0, 1], values: [[1], [2]], labels: ["Signal"], units: [""], metadata: {} },
  });
  const before = { datasets: [csv("c1", "decay-err.csv"), csv("c2", "two-channel.csv")], workbooks: [{ id: "wb-c1", name: "decay-err.csv" }, { id: "wb-c2", name: "two-channel.csv" }] };
  await set({ ...before, folders: [], expandedWorkbookIds: ["wb-c1", "wb-c2"], originFidelity: [], originFigures: [], librarySelection: null, selectedIds: [] });

  const rowTop = (id: string) => page.locator(`[data-ds-id="${id}"]`).first().evaluate((e) => Math.round(e.getBoundingClientRect().top));
  await expect(page.locator('[data-ds-id="c2"]').first()).toBeVisible();
  const tops = [await rowTop("c1"), await rowTop("c2")];

  // What an Origin import adds: the project's folder with its books, a
  // fidelity report and a recovered graph.
  const book = (id: string, wb: string, origin: string) => ({
    id, workbookId: wb, name: `proj:${origin}`,
    data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: { origin_book: origin } },
  });
  await set({
    folders: [{ id: "fproj", name: "proj", parentId: null, order: 0 }],
    expandedFolders: ["fproj"],
    workbooks: [...before.workbooks, { id: "wbA", name: "Book1", originBook: "Book1", folderId: "fproj" }, { id: "wbB", name: "Book2", originBook: "Book2", folderId: "fproj" }],
    datasets: [...before.datasets, book("o1", "wbA", "Book1"), book("o2", "wbB", "Book2")],
    expandedWorkbookIds: ["wb-c1", "wb-c2", "wbA", "wbB"],
    originFidelity: [{
      id: "fid-proj", stem: "proj", siblingIds: ["o1", "o2"],
      manifest: { version: 1, container: "opj", status: "best_effort", graph_records_total: 1, graph_records_actionable: 1, graph_records_filtered: 0, omissions: ["line_width"], filtered_figures: [] },
    }],
  });
  await expect(page.locator('[data-ds-id="o2"]').first()).toBeVisible();
  await page.waitForTimeout(300); // the lazy sections settle
  expect([await rowTop("c1"), await rowTop("c2")], "existing rows stay put").toEqual(tops);
});
