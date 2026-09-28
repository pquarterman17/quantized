import { expect, test } from "@playwright/test";

import { gotoApp } from "../utils/harness";

test("Remove all returns a populated project to the usable empty shell @core", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await gotoApp(page);
  await page.evaluate(() => {
    const app = (window as unknown as { __qz: { useApp: { getState: () => {
      addDataset: (dataset: object) => void;
    } } } }).__qz.useApp.getState();
    app.addDataset({
      id: "origin-sheet", name: "Book1",
      data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["Signal"], units: [""], metadata: {} },
    });
  });
  await expect(page.locator("[data-ds-id='origin-sheet']")).toBeVisible();

  await page.getByText("File", { exact: true }).click();
  await page.getByRole("button", { name: "Remove all…" }).click();
  await page.getByRole("button", { name: "Remove all", exact: true }).click();

  await expect(page.locator(".qzk-menubar")).toBeVisible();
  await expect(page.locator(".qzk-library")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No data loaded" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Import data/ }).first()).toBeVisible();
  await expect(page.locator("[data-ds-id]")).toHaveCount(0);
  expect(pageErrors).toEqual([]);

  // The empty center must not unmount Stage's command registration: removal
  // remains undoable for this session, exactly as the confirmation promises.
  await page.getByText("Edit", { exact: true }).click();
  await page.getByRole("button", { name: "Undo remove all" }).click();
  await expect(page.locator("[data-ds-id='origin-sheet']")).toBeVisible();
});
