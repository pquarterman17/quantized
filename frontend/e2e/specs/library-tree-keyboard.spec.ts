// Journey — the Library TREE as a WAI-ARIA tree (U5). Real-browser Tab
// coverage, the counterpart of details-keyboard.spec.ts: jsdom can assert
// tabindex attributes but cannot prove where Tab actually goes. Before U5
// every row and every row control (grip, "⋯", preview, tag buttons) was a
// sequential stop, so Tab walked the rendered window's ~170 buttons instead
// of leaving the list. Now the roving row is the tree's one stop; only its
// own controls follow it, and the next Tab leaves the tree.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

test("Library tree: one roving tab stop, Home/End, and Tab leaves the tree @core", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-a.csv"));
  await waitForDatasetCount(page, 1);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-b.csv"));
  await waitForDatasetCount(page, 2);

  const tree = page.getByRole("tree", { name: "Library" });
  await expect(tree).toBeVisible();
  const items = tree.getByRole("treeitem");
  expect(await items.count()).toBeGreaterThanOrEqual(2);
  await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);

  await items.first().click();
  await items.first().focus();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();
  await expect(tree.locator('[role="treeitem"][tabindex="0"]')).toHaveCount(1);
  // V1: Escape on a row keeps focus there (Details' model), never <body>.
  await page.keyboard.press("Escape");
  await expect(items.first()).toBeFocused();
  // ARIA-in-HTML: no treeitem is a <button>.
  await expect(tree.locator('button[role="treeitem"]')).toHaveCount(0);

  // Real Tab order: every stop until focus leaves the tree is the roving row's
  // own control — never another row — and it leaves within a handful of presses.
  let left = false;
  for (let i = 0; i < 8 && !left; i++) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      const treeEl = document.querySelector('[role="tree"]');
      if (!el || !treeEl?.contains(el)) return "outside";
      return el.closest('[role="treeitem"]') === treeEl.querySelector('[role="treeitem"]') ? "roving" : "other";
    });
    expect(where).not.toBe("other");
    left = where === "outside";
  }
  expect(left).toBe(true);
});
