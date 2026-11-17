// UX9-J: Edit > Undo history lists the recent edits (newest first, current
// state marked) and a click jumps back N steps at once; Redo then returns.
// Waits on STATE (the store's dataset count), not on the call.

import { expect, test, type Page } from "@playwright/test";

import { gotoApp, waitForDatasetCount } from "../utils/harness";

type QzWindow = {
  __qz: {
    useApp: {
      getState: () => {
        addDataset: (d: { id: string; name: string; data: unknown }) => void;
        redo: () => void;
        datasets: unknown[];
        future: unknown[];
      };
    };
  };
};

async function addDatasets(page: Page, n: number): Promise<void> {
  await page.evaluate((count) => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState();
    for (let i = 0; i < count; i++) {
      s.addDataset({
        id: `uh${i}`,
        name: `uh${i}`,
        data: { time: [1, 2, 3], values: [[1], [2], [3]], labels: ["m"], units: [""], metadata: {} },
      });
    }
  }, n);
}

test("Edit > Undo history jumps back several steps; Redo returns", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoApp(page);
  await addDatasets(page, 4);
  await waitForDatasetCount(page, 4);

  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: "Undo history" }).click();
  // Newest first: the current state is checked; the third row is two steps back.
  const rows = page.getByRole("menuitemcheckbox");
  await expect(rows.first()).toHaveAttribute("aria-checked", "true");
  await rows.nth(2).click();
  await waitForDatasetCount(page, 2);
  expect(
    await page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().future.length),
  ).toBe(2);

  // The redo stack is intact: two redos come back to four datasets.
  await page.evaluate(() => {
    const s = (window as unknown as QzWindow).__qz.useApp.getState();
    s.redo();
    s.redo();
  });
  await waitForDatasetCount(page, 4);
});
