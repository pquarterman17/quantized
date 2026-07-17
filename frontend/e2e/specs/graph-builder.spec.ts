// Journey (e) — Build a plot in the Graph Builder, Save it as a named
// PlotSpec (PlotSpecBar, GUI_INTERACTION_PLAN #11), reopen it, verify state
// restores (GUI_INTERACTION_PLAN #15). ZoneWell's click-to-assign <select>
// (the "keyboard / assistive-tech path", not the CHANNEL_DND drag) is used
// throughout — a real <select> commit through a real browser, not a fired
// jsdom change event. Not tagged `@core` — DOM form controls, not
// canvas/pointer-capture territory — runs at the 100% baseline only.

import { expect, type Locator, type Page, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

/** A ZoneWell by its exact title ("X"/"Y"/"Group"/"Facet") — `hasText`
 *  substring matching is unsafe here (the Y well's own hint text, "value
 *  axis…", contains a lowercase "x", so a plain `hasText: "X"` filter
 *  false-matches it too). */
function wellByTitle(page: Page, title: string): Locator {
  return page.locator(".qzk-zone-well").filter({ has: page.getByText(title, { exact: true }) });
}

test("build, save, and reopen a Graph Builder PlotSpec", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("two-channel.csv"));
  await waitForDatasetCount(page, 1);

  // Open via the Command Palette (mouse-optional entry point; the plan's #11
  // command lives in commands/analysisCommands.ts).
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Type a command…").fill("Graph Builder");
  await page.keyboard.press("Enter");

  const builder = page.locator(".qzk-glass").filter({ has: page.getByText("Graph Builder", { exact: true }) });
  await expect(builder).toBeVisible();

  await page.getByLabel("Assign a channel to X").selectOption({ label: "Resistance" });
  await page.getByLabel("Assign a channel to Y").selectOption({ label: "Voltage" });

  await expect(wellByTitle(page, "X").locator(".qzk-zone-chip")).toHaveText("Resistance×");
  await expect(wellByTitle(page, "Y").locator(".qzk-zone-chip").first()).toHaveText("Voltage×");

  // ── Save As a named PlotSpec ────────────────────────────────────────────
  await page.getByRole("button", { name: "Save As…" }).click();
  await page.locator(".qz-dialog input").fill("E2E test graph");
  await page.getByRole("button", { name: "Run" }).click();

  // Two matches once saved: the PlotSpecBar header's active-spec name span
  // AND the (still-collapsed) "Saved graphs" list row — `.first()` is the
  // visible header.
  await expect(page.getByText("E2E test graph", { exact: true }).first()).toBeVisible();

  const saved = await page.evaluate(
    () =>
      (
        window as unknown as {
          __qz: { useApp: { getState: () => { savedPlotSpecs: { name: string; spec: unknown }[] } } };
        }
      ).__qz.useApp.getState().savedPlotSpecs,
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe("E2E test graph");

  // ── Reset the builder (clears the wells), then reopen the saved graph via
  //    PlotSpecBar's "Saved graphs" list and verify the wells restore ──────
  // exact: true — a plain "Reset" substring also matches the plot toolbar's
  // unrelated "Reset View" button (aria-label).
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(wellByTitle(page, "X").locator(".qzk-zone-chip")).toHaveCount(0);

  // Scoped to the `<summary>` tag: an unscoped text search for "Saved
  // graphs" also false-matches the PlotSpecBar header row, whose
  // concatenated text ("Unsaved graph" + "Save" + "Save As…") happens to
  // contain "graphSave" — case-insensitively indistinguishable from "graphs".
  await page.locator("summary", { hasText: "Saved graphs" }).click(); // expand the collapsed Card
  // exact — Duplicate/Rename/Delete icon buttons all carry
  // `aria-label="<Action> E2E test graph"`, a superset substring match.
  await page.getByRole("button", { name: "E2E test graph", exact: true }).click(); // the Open row

  await expect(wellByTitle(page, "X").locator(".qzk-zone-chip")).toHaveText("Resistance×");
  await expect(wellByTitle(page, "Y").locator(".qzk-zone-chip").first()).toHaveText("Voltage×");

  const activeId = await page.evaluate(
    () =>
      (window as unknown as { __qz: { useApp: { getState: () => { activePlotSpecId: string | null } } } }).__qz
        .useApp.getState().activePlotSpecId,
  );
  expect(activeId).toBeTruthy();
});
