// Journey (c) — Right-click the plotted curve, change colour/marker via the
// context menu, verify the change stuck in the store (GUI_INTERACTION_PLAN
// #15). Right-clicks the REAL uPlot canvas overlay (`.u-over`) at its center
// — the fixture (`linear-ramp.csv`) is a monotonic diagonal, so the plot
// area's geometric center always sits within the context menu's hit-test
// tolerance (`HIT_PX = 44`, see lib/plotHitTest.ts), regardless of the
// autoscaled data range. This is exactly the canvas-hit-target + real-pointer
// gap jsdom can't validate (PlotContextMenu.test.tsx stubs the uPlot
// instance's scale/pixel math; it never clicks a live canvas).
//
// The context menu (ContextMenu.tsx) is under concurrent refactor per the
// task brief — every item here is located by its TEXT/accessible name
// (never DOM structure/class), so it survives that refactor. Colour
// swatches are plain <button>s (implicit role "button"), but the GUI_-
// INTERACTION #8 keyboard-complete pass gave every other row an EXPLICIT
// ARIA role — submenu triggers ("Marker") are role="menuitem", and leaf
// items with a `checked` state (shape options like "◆ diamond") are
// role="menuitemcheckbox" — so those two need the matching role, not
// "button" (see MenuList in ContextMenu.tsx).

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

interface SeriesStyle {
  color?: string;
  marker?: boolean;
  markerShape?: string;
}

async function readSeriesStyle(page: import("@playwright/test").Page, channel: number): Promise<SeriesStyle> {
  return page.evaluate(
    (ch) =>
      (
        window as unknown as {
          __qz: { useApp: { getState: () => { seriesStyles: Record<number, SeriesStyle> } } };
        }
      ).__qz.useApp.getState().seriesStyles[ch] ?? {},
    channel,
  );
}

test.describe("Plot canvas right-click curve restyle @core", () => {
  test("change colour and marker shape via the right-click menu", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);

    const plotOver = page.locator(".qzk-stage .u-over");
    await expect(plotOver).toBeVisible();

    // ── Colour: right-click near the curve, open the swatch row ───────────
    await plotOver.click({ button: "right" }); // defaults to the element's center
    // Swatch buttons carry no text content, so `title` IS the accessible
    // name (accname falls back to `title` only when there's no text/aria
    // source) — real getByRole('button', {name}) match, not a DOM hack. Its
    // presence also proves the click landed on the curve (hit-tested a
    // series), not empty plot space — the series-scoped swatch row only
    // renders when `PlotContextMenu`'s hit-test resolved a nearby series.
    await page.getByRole("button", { name: "Series 2" }).click();

    await expect.poll(() => readSeriesStyle(page, 0).then((s) => s.color)).toBe("--series-2");

    // ── Marker: right-click again, hover "Marker" to open its flyout (a
    //    click here would immediately re-toggle it closed — the submenu
    //    opens on mouseenter, see ContextMenu.tsx's MenuList), pick a shape ──
    await plotOver.click({ button: "right" });
    const markerTrigger = page.getByRole("menuitem", { name: "Marker" });
    await expect(markerTrigger).toBeVisible();
    await markerTrigger.hover();
    const diamondOption = page.getByRole("menuitemcheckbox", { name: "◆ diamond" });
    await expect(diamondOption).toBeVisible();
    await diamondOption.click();

    await expect.poll(() => readSeriesStyle(page, 0).then((s) => s.markerShape)).toBe("diamond");
    const marker = await readSeriesStyle(page, 0).then((s) => s.marker);
    expect(marker).toBe(true);
  });
});
