// P3.2 first-run acceptance: the true empty workspace presents an optional
// example and the choice reaches a useful scientific view without a backend
// round trip, file picker, command palette, or seeded harness state.

import { expect, test } from "@playwright/test";

import { gotoApp, waitForDatasetCount } from "../utils/harness";

test("Home can open a local 2-D example directly in the map view @core", async ({ page }) => {
  await gotoApp(page);

  await expect(page.getByText("Start here", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Guided import for unfamiliar files…" })).toBeVisible();
  await page.getByRole("button", { name: "2-D", exact: true }).click();

  await waitForDatasetCount(page, 1);
  await expect(page.locator("[data-ds-id]").first()).toContainText("example-2d-map");
  await expect(page.locator(".qzk-tab.active")).toHaveText("Map");
  await expect(page.locator(".qzk-stage canvas")).toBeVisible();

  const metadata = await page.evaluate(
    () =>
      (
        window as unknown as {
          __qz: { useApp: { getState: () => { datasets: { data: { metadata: Record<string, unknown> } }[] } } };
        }
      ).__qz.useApp.getState().datasets[0].data.metadata,
  );
  expect(metadata).toMatchObject({ is2D: true, source: "Quantized example" });
});

test("Home's grouped example reaches a labeled grouped plot", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "Grouped", exact: true }).click();
  await waitForDatasetCount(page, 1);
  await expect(page.locator(".qzk-tab.active")).toHaveText("Plot");
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
  await expect(page.locator(".qzk-legend")).toContainText("Lot A");
  await expect(page.locator(".qzk-legend")).toContainText("Lot B");
  await expect(page.locator(".qzk-legend")).toContainText("Lot C");
});
