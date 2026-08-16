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

  // Review round 2: `toBeVisible()` cannot catch PARTIAL clipping — the
  // original text button's right edge extended ~10px past its cell at the
  // default 210px panel. Assert the complete action sits INSIDE its cell,
  // at the default narrow width (compact glyph variant) AND at a widened
  // panel (full-text variant past the 300px container breakpoint).
  const assertRevealContained = async (): Promise<void> => {
    const btn = page.locator(".qzk-details-reveal").first();
    const cell = page.locator("td.qzk-details-actions").first();
    const b = (await btn.boundingBox())!;
    const c = (await cell.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(c.x - 0.5);
    expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width + 0.5);
    expect(b.y).toBeGreaterThanOrEqual(c.y - 0.5);
    expect(b.y + b.height).toBeLessThanOrEqual(c.y + c.height + 0.5);
    // The button keeps its accessible name in both variants.
    await expect(btn).toHaveAccessibleName("Show in Library");
  };
  await assertRevealContained(); // default 210px panel — the reported clip
  await page.evaluate(() => document.documentElement.style.setProperty("--lw", "420px"));
  await assertRevealContained(); // widened panel — the full-text variant
  await page.evaluate(() => document.documentElement.style.removeProperty("--lw"));

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
