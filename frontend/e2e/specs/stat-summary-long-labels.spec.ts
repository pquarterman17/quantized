// P2.6 leftovers (PRIMARY_SOFTWARE_AUDIT_PLAN boxes 1 and 4), through a real
// browser against the real backend:
//   * a GROUPED (two-factor) box plot exports a tiered axis, and its per-group
//     summary table's visibility is PlotView state — it rides the real `.dwk`
//     (File ▸ Save workspace, a reload, File ▸ Open workspace), exactly as
//     `empty levels` / `n` do;
//   * long upright category labels TURN on the canvas when they are wider
//     than their slot (`fit: "auto"`, `lib/statMarks.fitCategoryLabels`), and
//     turn back upright once the slots are wide enough — the canvas publishes
//     the painted rotation as `data-axis-rotation`; the export asks the figure
//     to apply the same rule in its own geometry (`axis_style.fit`).
// Not `@core` — DOM controls, a store field and a network payload; no canvas
// hit-testing.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { chooseFiles } from "../utils/fileChooser";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

interface StatplotBody {
  labels: string[];
  axis_style: { tiered: boolean; tiers?: [string, string][]; fit?: string | null } | null;
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

function showSummaryInStore(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __qz: { useApp: { getState: () => { statShowSummary: boolean } } } })
      .__qz.useApp.getState().statShowSummary,
  );
}

test("a grouped box plot's summary table stays open across a reload", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("lot-wafer-thickness.csv"));
  await waitForDatasetCount(page, 1);
  await runPaletteCommand(page, "Toggle statistics view");

  // Group by Lot, then by Wafer (a 1/2 integer column, discrete like
  // `grouped-runs.csv`'s Run — and, as the first categorical column, the
  // stage's default group, hence the explicit pick): six (lot, wafer) cells
  // on a two-tier axis, exported as such.
  await page.locator("label", { hasText: "group by" }).locator("select").selectOption({ label: "Lot" });
  await page.locator("label", { hasText: "then by" }).locator("select").selectOption({ label: "Wafer" });
  const grouped = await exportBody(page);
  expect(grouped.labels).toHaveLength(6);
  expect(grouped.labels[0]).toMatch(/^Lot = A \/ Wafer = 1$/);
  expect(grouped.axis_style?.tiered).toBe(true);
  expect(grouped.axis_style?.tiers).toHaveLength(6);

  // Open the summary table: one row per cell, and the choice is PlotView state.
  const dock = page.getByTestId("stat-summary-dock");
  await expect(dock).toBeHidden();
  await page.getByRole("checkbox", { name: "summary", exact: true }).click();
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("grid", { name: "Group summary" })).toBeVisible();
  expect(await showSummaryInStore(page)).toBe(true);

  // Save the project through the real File menu (the save freezes the
  // focused window's live view, flag included — `windowsForSave()`), then
  // reload the app and open that file back: the stage comes back with the
  // table open. (quick-figure-lifecycle.spec.ts's download / filechooser
  // precedent.) A live-view toggle alone does not re-arm the autosave
  // debounce — useWorkspaceAutosave's documented tradeoff — so the round
  // trip goes through the explicit save, not the recovery slot.
  await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByText("Save workspace (.dwk)…", { exact: true }).click(),
  ]);
  const savedPath = await download.path();
  expect(savedPath, "the .dwk download completed").toBeTruthy();

  await gotoApp(page);
  // The import's own autosave restores the dataset, so the workspace is
  // non-empty and opening a file confirms with Replace, deterministically.
  await waitForDatasetCount(page, 1);
  await page.locator(".qzk-menubar").getByText("File", { exact: true }).click();
  await chooseFiles(
    page,
    () => page.getByText("Open workspace (.dwk)…", { exact: true }).click(),
    savedPath!,
  );
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await waitForDatasetCount(page, 1);
  await expect(page.getByTestId("stat-summary-dock")).toBeVisible();
  expect(await showSummaryInStore(page)).toBe(true);

  // And it closes again from the same control.
  await page.getByRole("checkbox", { name: "summary", exact: true }).click();
  await expect(page.getByTestId("stat-summary-dock")).toBeHidden();
  expect(await showSummaryInStore(page)).toBe(false);
});

test("long upright category labels turn when wider than their slot, and turn back when it widens", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("anneal-long-levels.csv"));
  await waitForDatasetCount(page, 1);
  await runPaletteCommand(page, "Toggle statistics view");

  // Six 37-character labels cannot share a 1360 px window upright (nor wrap
  // within three lines), so the canvas rotates them 45 degrees.
  const host = page.getByTestId("stat-canvas-host");
  await expect(host).toHaveAttribute("data-axis-rotation", "45");

  // The export carries the same rule for the figure to apply over ITS metrics.
  const body = await exportBody(page);
  expect(body.labels).toHaveLength(6);
  expect(body.labels[0]).toMatch(/Anneal temperature under vacuum 400 C$/);
  expect(body.axis_style?.fit).toBe("auto");

  // Wide enough slots keep the same labels upright: the rotation follows the
  // pitch, not the label alone.
  await page.setViewportSize({ width: 3200, height: 900 });
  await expect(host).toHaveAttribute("data-axis-rotation", "0");
  await page.setViewportSize({ width: 1360, height: 900 });
  await expect(host).toHaveAttribute("data-axis-rotation", "45");
});
