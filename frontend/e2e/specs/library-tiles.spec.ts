// PR E-a: real-browser proof that Tiles uses the Stage-sized workspace,
// retains the sidebar tree, and returns to the unchanged active plot.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

const activeId = (page: import("@playwright/test").Page): Promise<string | null> =>
  page.evaluate(() => (
    window as unknown as { __qz: { useApp: { getState: () => { activeId: string | null } } } }
  ).__qz.useApp.getState().activeId);

test("Tiles occupies the main workspace and Escape restores the unchanged plot @core", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-a.csv"));
  await waitForDatasetCount(page, 1);
  const before = await activeId(page);
  expect(before).not.toBeNull();

  await page.getByRole("button", { name: "Tiles" }).click();
  await expect(page.getByLabel("Library workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tiles" })).toHaveAttribute("aria-pressed", "true");
  // The narrow Library remains mounted as navigation while the former Stage
  // area contains a genuine wide tile grid.
  await expect(page.locator(".qzk-library")).toBeVisible();
  await expect(page.getByRole("gridcell", { name: /dataset-a\.csv, Worksheet/ })).toBeVisible();
  await expect(page.getByLabel(/Data preview for dataset-a\.csv/)).toBeVisible();
  await expect(page.getByText("Worksheet · 11 rows × 1 column")).toBeVisible();
  expect(await activeId(page)).toBe(before);
  await page.evaluate(() => (
    window as unknown as { __qz: { useApp: { getState: () => { setPlotTool: (tool: string) => void } } } }
  ).__qz.useApp.getState().setPlotTool("zoom"));

  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Library workspace")).toHaveCount(0);
  await expect(page.locator(".qzk-stage-cell")).toBeVisible();
  expect(await activeId(page)).toBe(before);
  expect(await page.evaluate(() => (
    window as unknown as { __qz: { useApp: { getState: () => { plotTool: string } } } }
  ).__qz.useApp.getState().plotTool)).toBe("zoom");
});
