// Robust / quantile fits (GAP_AUDIT_9 G11) in a real browser: the Advanced
// tab's "Robust and quantile fit" recovers the true line (y = 2 + 0.5 x) from
// data with three injected outliers where least squares is pulled away.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { classicLayout, gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

// Owner decision 2026-11-26: the window layout is now the default. This spec drives the CLASSIC layout
// (stage tabs, side-column tool windows), so it opts in explicitly and keeps its coverage.
test.beforeEach(async ({ page }) => {
  await classicLayout(page);
});

test("robust loss and quantile fit on data with outliers", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("line-outliers.csv"));
  await waitForDatasetCount(page, 1);
  await runPaletteCommand(page, "Curve fit…");
  const panel = page.locator(".qzk-win").filter({ has: page.getByText("Curve fit", { exact: true }) });
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "Advanced" }).click();

  await panel.getByLabel("Robust scale").scrollIntoViewIfNeeded();
  await panel.getByRole("button", { name: "Run robust fit" }).click();
  await expect(panel.getByText(/downweighted point/)).toContainText("3 downweighted");
  await page.screenshot({ path: process.env.QZ_SHOT ?? "robust-fit.png" });
  const table = panel.locator("table").filter({ hasText: "least squares" });
  const text = await table.innerText();
  console.log("ROBUST TABLE\n" + text);
});
