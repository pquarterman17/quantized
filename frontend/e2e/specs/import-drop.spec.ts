// Journey (a) — Import via file-drop (GUI_INTERACTION_PLAN #15).
// Drops a synthetic CSV onto the Library's file-import dropzone and verifies
// the dataset appears (and gets plotted, since a fresh import auto-activates
// — see store/useApp.ts's `addDataset`). Real HTML5 drag/drop + a real
// backend parse round-trip: neither is reachable from jsdom.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

const FIXTURE = fixturePath("linear-ramp.csv");

test("drop a CSV onto the Library and it appears as a dataset @core", async ({ page }) => {
  await gotoApp(page);

  const library = page.locator(".qzk-library");
  await dropFileOnto(page, library, FIXTURE);

  await waitForDatasetCount(page, 1);
  await expect(page.locator("[data-ds-id]").first()).toContainText("linear-ramp");

  // A fresh import auto-activates + plots into the focused window (item 15's
  // "dataset appears in the Library" also implies it became the live plot —
  // addDataset rebinds the focused window's datasetId synchronously).
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();

  const datasetCount = await page.evaluate(
    () => (window as unknown as { __qz: { useApp: { getState: () => { datasets: unknown[] } } } }).__qz.useApp
      .getState().datasets.length,
  );
  expect(datasetCount).toBe(1);
});
