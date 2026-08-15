// Journey — Details-view roving keyboard traversal (plan follow-up 4a,
// PR #141). Real-browser TAB-SEQUENCE coverage: jsdom can assert tabindex
// attributes but cannot prove what Tab actually focuses next — which is
// exactly how the wrapper-second-tab-stop defect escaped the unit suite in
// this PR's first commit. This journey drives the real focus order: the
// scroll wrapper is out of the Tab order, the roving row is the table's one
// sequential stop, arrows traverse the visible row order without stepping
// the global prev/next-dataset navigation, and Enter opens canonically.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

const activeId = (page: import("@playwright/test").Page): Promise<string | null> =>
  page.evaluate(
    () => (window as unknown as { __qz: { useApp: { getState: () => { activeId: string | null } } } }).__qz.useApp
      .getState().activeId,
  );
const focusedRowKey = (page: import("@playwright/test").Page): Promise<string | null> =>
  page.evaluate(() => document.activeElement?.getAttribute("data-lib-row") ?? null);

test("Details view: one tab stop, arrow traversal, Enter opens; global dataset nav stays gated @core", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-a.csv"));
  await waitForDatasetCount(page, 1);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-b.csv"));
  await waitForDatasetCount(page, 2);

  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByLabel("Library details table")).toBeVisible();

  // P1 fix: the wrapper is NOT in the Tab order; the roving row is the
  // table's single sequential stop.
  await expect(page.locator(".qzk-details-scroll")).not.toHaveAttribute("tabindex", /.+/);
  // Two stops since the header-roving follow-on: one header button + one row.
  await expect(page.locator('.qzk-details-wrap [tabindex="0"]')).toHaveCount(2);
  await expect(page.locator('.qzk-details-wrap thead [tabindex="0"]')).toHaveCount(1);

  const activeBefore = await activeId(page); // dataset-b, from import auto-activation
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(4); // 2 workbooks + their worksheets

  // Real focus traversal from the first row: down, clamp is covered by the
  // unit suite — here we prove the BROWSER moves focus row-to-row and the
  // global navigator never steps while it does.
  await rows.first().click();
  await rows.first().focus();
  const first = await focusedRowKey(page);
  expect(first).not.toBeNull();
  await page.keyboard.press("ArrowDown");
  const second = await focusedRowKey(page);
  expect(second).not.toBeNull();
  expect(second).not.toBe(first);
  await page.keyboard.press("End");
  const last = await focusedRowKey(page);
  await page.keyboard.press("Home");
  expect(await focusedRowKey(page)).toBe(first);
  expect(last).not.toBe(first);
  expect(await activeId(page)).toBe(activeBefore); // arrows never re-plotted anything

  // Tab leaves the table in ONE step — no wrapper stop to pass through on
  // the way out, and focus does not land on another row.
  await page.keyboard.press("Tab");
  expect(await focusedRowKey(page)).toBeNull();

  // Enter on a roved-to worksheet row opens it canonically.
  await page.keyboard.press("Shift+Tab"); // back onto the roving row
  await page.keyboard.press("ArrowDown"); // a worksheet row (row 2 under the first workbook)
  const opened = await focusedRowKey(page);
  await page.keyboard.press("Enter");
  await expect.poll(() => activeId(page)).toBe(opened?.replace("worksheet:", ""));
});
