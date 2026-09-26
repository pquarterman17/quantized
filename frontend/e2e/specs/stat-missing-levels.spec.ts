// P2.6 box 2 (PRIMARY_SOFTWARE_AUDIT_PLAN) — "missing levels and unbalanced
// groups are explicit", through a real browser against the real backend.
//
// Fixture `lot-missing-level.csv`: Lot A has 12 rows, Lot B 2, Lot C 2 rows
// whose Thickness cells are EMPTY (NaN). Before this box, the Stat Stage box
// plot showed two boxes and never mentioned Lot C, and its export did the
// same. Now:
//   * the notice names the empty level, the dropped rows and the small /
//     unbalanced caveat;
//   * the export posts Lot C as an EMPTY group in its axis slot, with the
//     per-group n annotation and the caveat, and the real route renders it;
//   * "empty levels" off removes the slot from screen and export alike, and
//     the choice is store (PlotView) state, so it persists with the plot.
// Not `@core` — DOM controls and a network payload, no canvas hit-testing.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface StatplotBody {
  data: number[][];
  labels: string[];
  show_n?: boolean;
  caveat?: string | null;
}

/** Click Export and return the request body the stage posted, after the real
 *  route answered 200. */
async function exportBody(page: Page): Promise<StatplotBody> {
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/export/statplot-figure") && r.method() === "POST"),
    page.getByRole("button", { name: /Export/ }).click(),
  ]);
  const res = await req.response();
  expect(res?.status()).toBe(200);
  return req.postDataJSON() as StatplotBody;
}

test("a level with no usable data keeps its slot, is explained, and exports the same way", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("lot-missing-level.csv"));
  await waitForDatasetCount(page, 1);
  await runPaletteCommand(page, "Toggle statistics view");

  const notice = page.getByTestId("stat-group-notice");
  await expect(notice).toContainText("1 empty level (n=0)");
  await expect(notice).toContainText("n < 3 in 1 group");
  await expect(notice).toContainText("unbalanced groups (n 2-12)");
  await expect(notice).toContainText("2 rows dropped (2 non-finite, 0 excluded/filtered)");
  await expect(notice).toHaveAttribute("title", /Lot = C: n=0, 2 non-finite/);

  const shown = await exportBody(page);
  expect(shown.labels).toEqual(["Lot = A", "Lot = B", "Lot = C"]);
  expect(shown.data.map((g) => g.length)).toEqual([12, 2, 0]);
  expect(shown.show_n).toBe(true);
  expect(shown.caveat).toContain("unbalanced groups (n 2-12)");

  // Hide empty levels: gone from the screen's notice AND the export, and the
  // choice is PlotView state (it rides the window snapshot and the .dwk).
  await page.getByRole("checkbox", { name: "empty levels", exact: true }).click();
  await expect(notice).toContainText("1 empty level hidden");
  const hidden = await exportBody(page);
  expect(hidden.labels).toEqual(["Lot = A", "Lot = B"]);
  const persisted = await page.evaluate(
    () => (window as unknown as { __qz: { useApp: { getState: () => { statHideEmptyLevels: boolean } } } })
      .__qz.useApp.getState().statHideEmptyLevels,
  );
  expect(persisted).toBe(true);

  // The n annotation is optional, and the export follows it.
  await page.getByRole("checkbox", { name: "n", exact: true }).click();
  expect((await exportBody(page)).show_n).toBe(false);
});
