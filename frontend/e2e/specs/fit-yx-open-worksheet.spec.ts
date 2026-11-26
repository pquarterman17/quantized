// SCIENTIFIC_WORKBENCH plan, "Worksheet actions strand users in dockable layout", found end to
// end: in the window layout (the default) Fit Y by X > Open as worksheet showed the "not in the
// window layout yet" notice, and the OPEN Fit Y by X panel then switched its input to the new
// output (X = level, Y = F) and broke ("need at least 2 non-empty levels").
//
// Opening an output is an explicit open, not a selection: the sheet appears in a window of its
// own, the source plot stays, and the running analysis keeps its input and its result.
// Not `@core`: DOM and store behaviour, no canvas hit-testing.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

test("Open as worksheet shows the output in a window and the open Fit Y by X keeps its input", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator(".qzk-wl")).toBeVisible(); // the window layout is the default
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("lot-wafer-thickness.csv"));
  await waitForDatasetCount(page, 1);

  await runPaletteCommand(page, "Fit Y by X");
  // Docked in the layout the tool is a `data-wl-window` frame; floating, a `data-tool-window` one.
  const panel = page.locator('[data-wl-window="tool:fit-y-by-x"], [data-tool-window="fit-y-by-x"]').first();
  await expect(panel).toBeVisible();
  await panel.getByLabel("X (factor)").selectOption({ label: "Lot" });
  await panel.getByLabel("Y (response)").selectOption({ label: "Thickness" });
  await expect(panel.getByText("Group comparison")).toBeVisible();

  const windowsBefore = await page.locator("[data-wl-window]").count();
  await panel.getByRole("button", { name: "Save result" }).click();
  await expect(panel.getByText("Saved", { exact: true })).toBeVisible();

  const open = panel.getByRole("button", { name: /^Open as worksheet:/ }).first();
  await open.scrollIntoViewIfNeeded();
  await open.click();

  // The output is on screen as a worksheet window, with no detour through the classic layout.
  await expect(page.locator('[data-wl-window] [role="grid"]').first()).toBeVisible();
  await expect(page.locator(".qzk-wl")).toBeVisible();
  await expect(page.getByText(/view is not in the window layout yet/)).toHaveCount(0);
  await expect.poll(() => page.locator("[data-wl-window]").count()).toBeGreaterThan(windowsBefore);

  // The analysis was not retargeted: same columns, same result, no "need at least 2 non-empty levels".
  await expect(panel.getByLabel("X (factor)")).toHaveValue(/.+/);
  await expect(panel.getByLabel("X (factor)").locator("option:checked")).toHaveText("Lot");
  await expect(panel.getByLabel("Y (response)").locator("option:checked")).toHaveText("Thickness");
  await expect(panel.getByText("Group comparison")).toBeVisible();
  await expect(panel.getByText(/need at least 2 non-empty levels/)).toHaveCount(0);
});
