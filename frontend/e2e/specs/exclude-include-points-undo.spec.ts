// Plot right-click menu — Exclude / Include points (origin gap audit 2 #7,
// #660), end to end against the real backend: brush an x-range with Select
// Rows, mask it from the plot menu, then unmask it, each as one undoable
// step (Ctrl+Z walks back through both). The masked points stay in the
// worksheet (greyed) but drop out of the plot, fits and exports
// (lib/rowstate.ts) — this spec checks the dataset's own `excludedRows`,
// not pixels, per the "wait on state" convention.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

type QzWindow = {
  __qz: {
    useApp: {
      getState: () => {
        setXLim: (lim: [number, number] | null) => void;
        selection: { rows: number[] } | null;
        activeId: string | null;
        datasets: { id: string; excludedRows?: number[] }[];
      };
    };
  };
};

const read = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState();
    const d = s.datasets.find((x) => x.id === s.activeId);
    return { selected: s.selection?.rows.length ?? 0, excluded: d?.excludedRows?.length ?? 0 };
  });

async function setXLim(page: Page, lim: [number, number]): Promise<void> {
  await page.evaluate((l) => {
    (window as unknown as QzWindow).__qz.useApp.getState().setXLim(l);
  }, lim);
}

/** Client pixel of data x on the stage plot, for a pinned [lo, hi] x range —
 *  same recipe as peak-fit-range-and-add.spec.ts (the plot is briefly
 *  rebuilt after a selection changes, so `.u-over`'s box is polled). */
async function pixelAt(page: Page, lim: [number, number], x: number): Promise<{ x: number; y: number }> {
  const over = page.locator(".qzk-stage .u-over");
  let box: { x: number; y: number; width: number; height: number } | null = null;
  await expect.poll(async () => (box = await over.boundingBox()) !== null).toBe(true);
  const b = box!;
  return { x: b.x + ((x - lim[0]) / (lim[1] - lim[0])) * b.width, y: b.y + b.height * 0.5 };
}

test("Exclude selected points, Include all points, and undo both", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  const lim: [number, number] = [0, 10];
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-a.csv"));
  await waitForDatasetCount(page, 1);
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
  await setXLim(page, lim);

  // Brush x in [2, 5] with Select Rows.
  await page.getByRole("button", { name: "Select Rows" }).click();
  const from = await pixelAt(page, lim, 2);
  const to = await pixelAt(page, lim, 5);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  const afterBrush = await read(page);
  expect(afterBrush.selected).toBeGreaterThan(0);
  const selected = afterBrush.selected;

  // Right-click the plot and exclude the brushed selection.
  const at = await pixelAt(page, lim, 3);
  await page.mouse.click(at.x, at.y, { button: "right" });
  const excludeItem = page.getByRole("menuitem", { name: `Exclude selected points (${selected})` });
  await expect(excludeItem).toBeEnabled();
  await excludeItem.click();
  await expect.poll(async () => (await read(page)).excluded).toBe(selected);
  // Excluding clears the brush — nothing stays double-counted.
  await expect.poll(async () => (await read(page)).selected).toBe(0);

  // Right-click again and include everything back.
  await page.mouse.click(at.x, at.y, { button: "right" });
  const includeAllItem = page.getByRole("menuitem", { name: `Include all points (${selected})` });
  await expect(includeAllItem).toBeEnabled();
  await includeAllItem.click();
  await expect.poll(async () => (await read(page)).excluded).toBe(0);

  // Undo the "include all" — back to excluded.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await read(page)).excluded).toBe(selected);

  // Undo the "exclude selected" — back to nothing excluded.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await read(page)).excluded).toBe(0);
});
