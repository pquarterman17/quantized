import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "../utils/harness";

// A large Origin project imports a handful of graph windows that bind no
// source book (fit-report layers the importer fails closed on). They used to
// land as separate Library rows that draw nothing; they now sit under ONE
// collapsed "Unresolved Origin figures (N)" node per project. No public
// specimen produces unresolved figures (checked: every corpus .opj/.opju
// resolves all of its graphs), so this seeds the store the way an import
// leaves it.
async function seed(page: Page, unresolved: number): Promise<void> {
  await page.evaluate((n) => {
    const useApp = (window as unknown as { __qz: { useApp: { setState: (state: object) => void } } }).__qz.useApp;
    const sheet = (id: string, workbookId: string, book: string) => ({
      id, workbookId, name: `proj:${book}`,
      data: { time: [0, 1], values: [[1], [2]], labels: ["Signal"], units: [""], metadata: { origin_book: book } },
    });
    const fig = (id: string, datasetId: string | null) => ({
      id, stem: "proj", datasetId, siblingIds: ["d1"],
      figure: { name: id === "good" ? "Graph1" : "", x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false, n_curves: 0, annotations: [] },
    });
    useApp.setState({
      folders: [{ id: "f1", name: "proj", parentId: null, order: 0 }],
      expandedFolders: ["f1"],
      workbooks: [{ id: "w1", name: "Book1", originBook: "Book1", folderId: "f1" }],
      datasets: [sheet("d1", "w1", "Book1")],
      originFigures: [fig("good", "d1"), ...Array.from({ length: n }, (_, i) => fig(`unnamed-fig-${i}`, null))],
      expandedWorkbookIds: ["w1"],
      expandedOriginGroupIds: [],
      librarySelection: null,
      selectedIds: [],
    });
  }, unresolved);
}

const group = (page: Page) => page.getByRole("treeitem", { name: /^Unresolved Origin figures \(\d+\)/ });

test("unresolved Origin figures collapse into one node; mouse and keyboard disclose it @core", async ({ page }) => {
  await gotoApp(page);
  await seed(page, 4);

  await expect(group(page)).toHaveCount(1);
  await expect(group(page)).toContainText("Unresolved Origin figures (4)");
  await expect(group(page)).toHaveAttribute("aria-expanded", "false");
  // The resolved graph stays under its book; the 4 unresolved are tucked away.
  await expect(page.locator('[data-lib-row="origin-figure:good"]')).toHaveCount(1);
  await expect(page.locator('[data-lib-row^="origin-figure:unnamed-fig-"]')).toHaveCount(0);

  // Mouse: click to expand, click to collapse.
  await group(page).click();
  await expect(group(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('[data-lib-row^="origin-figure:unnamed-fig-"]')).toHaveCount(4);
  await group(page).click();
  await expect(page.locator('[data-lib-row^="origin-figure:unnamed-fig-"]')).toHaveCount(0);

  // Keyboard: → expands, → enters the first member, ← returns, ← collapses.
  await group(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(group(page)).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-lib-row="origin-figure:unnamed-fig-0"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-lib-row="origin-figure:unnamed-fig-1"]')).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(group(page)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(group(page)).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(group(page)).toHaveAttribute("aria-expanded", "true");
});

test("members of the group stay selectable and say why they are unresolved", async ({ page }) => {
  await gotoApp(page);
  await seed(page, 3);
  await group(page).click();
  const member = page.locator('[data-lib-row="origin-figure:unnamed-fig-1"]');
  await member.click();
  await expect(member).toHaveAttribute("aria-selected", "true");
  await expect(group(page)).toHaveAttribute("aria-selected", "false");
  await expect(member).toHaveAttribute("aria-description", /unresolved .*Recover/);
});

test("a single unresolved graph is not grouped", async ({ page }) => {
  await gotoApp(page);
  await seed(page, 1);
  await expect(group(page)).toHaveCount(0);
  await expect(page.locator('[data-lib-row="origin-figure:unnamed-fig-0"]')).toHaveCount(1);
});
