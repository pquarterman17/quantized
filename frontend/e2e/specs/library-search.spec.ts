// Journey — project-wide search results + Show in Library reveal (PR D2,
// L0.26). Real-browser proof of the full loop jsdom can only approximate:
// type a query over an imported project, get the flat Details-style results
// surface (workbook and worksheet matches with breadcrumbs), open a result
// normally, then "Show in Library" — the query clears, the hierarchy
// re-renders, and the revealed row is actually visible and selected.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

const state = <T,>(page: import("@playwright/test").Page, pick: string): Promise<T> =>
  page.evaluate(
    (expr) => {
      const s = (window as unknown as { __qz: { useApp: { getState: () => Record<string, unknown> } } }).__qz.useApp.getState();
      return s[expr] as never;
    },
    pick,
  );

test("search spans the project, results open normally, Show in Library reveals @core", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-a.csv"));
  await waitForDatasetCount(page, 1);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-b.csv"));
  await waitForDatasetCount(page, 2);

  const filter = page.getByPlaceholder(/Filter/);

  // A query renders the flat results surface in place of the tree — and it
  // spans the PROJECT: the auto-created workbook (named after the import)
  // matches by name right alongside its worksheet.
  await filter.fill("dataset-a");
  await expect(page.getByLabel("Library details table")).toBeVisible();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(2); // workbook "dataset-a" + worksheet dataset-a.csv
  await expect(page.locator(".qzk-details-reveal").first()).toBeVisible();
  // The non-matching import is not in the results.
  await expect(page.locator("tbody").getByText("dataset-b.csv")).toHaveCount(0);

  // Opening a result uses its normal open behavior (worksheet -> activate).
  const wsRow = page.locator('tbody tr[data-ds-id]').first();
  await wsRow.dblclick();
  const activeAfterOpen = await state<string | null>(page, "activeId");
  expect(activeAfterOpen).not.toBeNull();

  // Show in Library: search still active, reveal the worksheet result.
  await filter.fill("dataset-a.csv");
  await expect(page.locator("tbody tr[data-ds-id]")).toHaveCount(1);
  await page.locator(".qzk-details-reveal").last().click();

  // The query cleared, the hierarchy is back, and the revealed row is a
  // real visible tree row, selected per the L0.25 contract.
  await expect(filter).toHaveValue("");
  await expect(page.getByLabel("Library details table")).toHaveCount(0);
  const revealed = page.locator('[data-ds-id]').filter({ hasText: "dataset-a.csv" }).first();
  await expect(revealed).toBeVisible();
  const selected = await state<string[]>(page, "selectedIds");
  expect(selected).toHaveLength(1);

  // No-matches note for a dead query.
  await filter.fill("zzz-nothing");
  await expect(page.getByText("No matches")).toBeVisible();
});
