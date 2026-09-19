// P3.3 round 3 — the gap that let a real regression ship: NO spec in this
// suite ever paired a floating workshop with an open workspace, so the whole
// 56-test run stayed green while Escape did the wrong thing in a real browser.
//
// What went wrong (round 2, `LibraryWorkspace`/`QuickFigureBuilderWorkspace`
// each `preventDefault()`ing every Escape they saw): with Tiles open and a
// workshop focused, Escape closed the WORKSPACE and left the panel open — and
// the second Escape did nothing at all, because closing the workspace pulled
// focus out of the panel onto a Library row. The only keyboard dismissal a
// workshop has was dead exactly where a user would reach for it.
//
// THE INVARIANT, in a real browser: the innermost open surface claims Escape,
// and the next Escape goes to the one below it. jsdom pins the same thing
// (LibraryWorkspace.test.tsx, QuickFigureBuilderWorkspace.test.tsx), but the
// regression was a question of native event phases and real focus movement,
// which is what this spec exists to check.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

/** Open a dataset, the Graph Builder workshop, and the Tiles workspace, in
 *  that order — `runPaletteCommand` presses Escape to force a clean palette
 *  transition, which would dismiss the workspace if it went second.
 *
 *  Waiting for a TILE, not just `getByLabel("Library workspace")`, is
 *  load-bearing: `App.tsx` renders `LibraryWorkspace` lazily behind a
 *  `Suspense` fallback that carries the same `aria-label`, so the label alone
 *  matches a placeholder whose chunk has not arrived and which has registered
 *  no Escape handler yet. Diagnosed here by watching the workspace survive an
 *  Escape it should have claimed. */
async function openWorkshopOverTiles(page: Page): Promise<{ builder: ReturnType<Page["locator"]> }> {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("dataset-a.csv"));
  await waitForDatasetCount(page, 1);

  await runPaletteCommand(page, "Graph Builder");
  const builder = page.locator(".qzk-win").filter({ has: page.getByText("Graph Builder", { exact: true }) });
  await expect(builder).toBeVisible();

  await page.getByRole("button", { name: "Tiles" }).click();
  await expect(page.getByLabel("Library workspace")).toBeVisible();
  await expect(page.getByLabel(/Data preview for dataset-a\.csv/)).toBeVisible();

  return { builder };
}

test("Escape closes the focused workshop first, the Tiles workspace second @core", async ({ page }) => {
  const { builder } = await openWorkshopOverTiles(page);
  const workspace = page.getByLabel("Library workspace");

  // Click into the panel, the way a user returning to it does. Focus decides
  // which surface owns the key: a workshop claims Escape only while the user
  // is inside it.
  await builder.locator(".qzk-win-title").click();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest(".qzk-win") != null))
    .toBe(true);

  // ── Escape #1: the workshop goes, the workspace stays ──────────────────
  await page.keyboard.press("Escape");
  await expect(builder).toHaveCount(0);
  await expect(workspace).toBeVisible();

  // ── Escape #2: now the workspace ───────────────────────────────────────
  await page.keyboard.press("Escape");
  await expect(workspace).toHaveCount(0);
  await expect(page.locator(".qzk-stage-cell")).toBeVisible();
});

test("with a workshop open, Escape from outside it still closes Tiles @core", async ({ page }) => {
  // The other half of the invariant: the window layer DECLINES when focus is
  // not inside its frame, so the walk falls through to the workspace instead
  // of the panel swallowing a key the user did not aim at it. Clicking the
  // Tiles toggle is what put focus outside the panel — no extra step needed,
  // and it is exactly where a real user's focus sits at this moment.
  const { builder } = await openWorkshopOverTiles(page);
  const workspace = page.getByLabel("Library workspace");

  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest(".qzk-win") == null))
    .toBe(true);

  await page.keyboard.press("Escape");
  await expect(workspace).toHaveCount(0);
  await expect(builder).toBeVisible(); // the panel is untouched
});
