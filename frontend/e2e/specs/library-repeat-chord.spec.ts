// Journey: the repeat-last chord (Ctrl+Backspace) pressed on a focused Library
// row. Acceptance found the row's own Backspace handler caught it, opened
// "Delete ... Move to trash", and once removed the dataset. A modified
// Backspace/Delete must reach the repeat command and never delete.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

type Qz = { __qz: { useApp: { getState: () => { status: string; datasets: unknown[]; trash: unknown[] } } } };

test("Ctrl+Backspace on a focused Library row repeats; it never opens Delete or removes the dataset", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-a.csv"));
  await waitForDatasetCount(page, 1);

  const row = page.locator("[data-ds-id]").first();
  await row.click();
  await row.focus();
  await page.keyboard.press("Control+Backspace");

  // The repeat command answered (nothing to repeat yet is still its answer)...
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Qz).__qz.useApp.getState().status))
    .toMatch(/repeat/i);
  // ...no delete prompt opened, and the dataset is still there, not in Trash.
  await expect(page.getByText(/Move to trash|Remove 1 dataset/i)).toHaveCount(0);
  const state = await page.evaluate(() => {
    const s = (window as unknown as Qz).__qz.useApp.getState();
    return { datasets: s.datasets.length, trash: s.trash.length };
  });
  expect(state).toEqual({ datasets: 1, trash: 0 });
});
