// P3.2 first-run acceptance: the true empty workspace presents an optional
// example, and the choice reaches a scientific view with no file picker,
// command palette, or seeded harness state. Loading the example itself needs
// no backend round trip (it is generated in the page); rendering it uses the
// ordinary plot/map fetch-with-offline-fallback path like any dataset.

import { expect, test } from "@playwright/test";

import { classicLayout, gotoApp, waitForDatasetCount } from "../utils/harness";

// Owner decision 2026-11-26: the window layout is now the default. This spec drives the CLASSIC layout
// (stage tabs, side-column tool windows), so it opts in explicitly and keeps its coverage.
test.beforeEach(async ({ page }) => {
  await classicLayout(page);
});

test("Home can open a local 2-D example directly in the map view @core", async ({ page }) => {
  await gotoApp(page);

  // UX8-I: one empty state -- the stage card owns the import entry points, the
  // Library keeps only the example chips.
  await expect(page.getByRole("button", { name: "Import wizard…" })).toHaveCount(1);
  await expect(page.getByText("Try an example", { exact: true })).toBeVisible();
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
  await expect(page.locator(".qzk-stage .qzk-legend")).toContainText("Lot A");
  await expect(page.locator(".qzk-stage .qzk-legend")).toContainText("Lot B");
  await expect(page.locator(".qzk-stage .qzk-legend")).toContainText("Lot C");
});
