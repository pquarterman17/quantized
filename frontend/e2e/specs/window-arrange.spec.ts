// Journey (residual #15 item) — multi-window arrange/restore
// (GUI_INTERACTION_PLAN #15). Plain DOM/keyboard interactions (Command
// Palette commands + title-bar pointer events) — not canvas hit-testing or
// native drag-and-drop, so this runs at the 100% baseline only (see
// README's zoom-matrix note: axis editing / Graph Builder / keyboard-only
// follow the same rule).
//
// Store shape: `plotWindows: PlotWindow[]` always starts with exactly ONE
// window (`winState: "maximized"`, store/windows.ts's `mainWindow`) — the
// ≥1-window invariant. "New Graph Window" (useWindowCommands.ts) is run
// twice via the ⌘K palette (the same palette flow keyboard-only.spec.ts
// already exercises for import) to reach 3 windows, giving Tile/Cascade
// something real to lay out and leaving one extra window to close at the end.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

interface WindowSnapshot {
  id: string;
  winState: "normal" | "minimized" | "maximized";
  geometry: { x: number; y: number; w: number; h: number };
}

async function readWindows(page: Page): Promise<WindowSnapshot[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __qz: { useApp: { getState: () => { plotWindows: WindowSnapshot[] } } } }).__qz.useApp
        .getState().plotWindows,
  );
}

/** Run a Command Palette command by its exact label — the same ⌘K flow
 *  keyboard-only.spec.ts uses for "Import data…", reused here for the
 *  Window-menu commands `useWindowCommands.ts` publishes into the SAME
 *  registry (MenuBar merges `useCommands().menuCommands`, so these are
 *  reachable from the Window menu too — the palette is just the more
 *  deterministic path to drive from a spec: fuzzy-filter to the exact
 *  label, Enter runs whatever's highlighted at cursor 0). */
async function runPaletteCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Type a command…").fill(label);
  // The item's text also carries its shortcut badge (e.g. "New Graph
  // Window⌘⇧N") when the command has one — containment, not equality.
  await expect(page.locator(".qz-cmdk-item").first()).toContainText(label);
  await page.keyboard.press("Enter");
}

/** True if two axis-aligned rects (x/y/w/h) do NOT overlap — used to assert
 *  Tile Windows produced a genuine non-overlapping grid. */
function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test.describe("Window arrange, tile, cascade, maximize/restore, and close", () => {
  test("create windows, tile, cascade, maximize/restore via the title bar, close via its context menu", async ({
    page,
  }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);

    let windows = await readWindows(page);
    expect(windows).toHaveLength(1);
    expect(windows[0].winState).toBe("maximized");

    // ── New Graph Window x2 -> 3 windows total ─────────────────────────────
    await runPaletteCommand(page, "New Graph Window");
    await expect.poll(async () => (await readWindows(page)).length).toBe(2);
    await runPaletteCommand(page, "New Graph Window");
    await expect.poll(async () => (await readWindows(page)).length).toBe(3);

    // ── Tile Windows: every visible window becomes "normal" and the
    //    resulting geometries form a non-overlapping grid. ─────────────────
    await runPaletteCommand(page, "Tile Windows");
    await expect.poll(async () => (await readWindows(page)).every((w) => w.winState === "normal")).toBe(true);
    windows = await readWindows(page);
    expect(windows).toHaveLength(3);
    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        expect(rectsOverlap(windows[i].geometry, windows[j].geometry)).toBe(false);
      }
    }

    // ── Cascade Windows: staggered offsets (lib/plotview.ts's
    //    cascadeLayout — each window's geometry is CASCADE_ORIGIN +
    //    index*CASCADE_STEP for BOTH x and y, so every window's x equals its
    //    own y, x/y strictly increase down the (array-order) list, and every
    //    window keeps the same size). ────────────────────────────────────
    await runPaletteCommand(page, "Cascade Windows");
    await expect
      .poll(async () => {
        const ws = await readWindows(page);
        const xEqualsY = ws.every((w) => w.geometry.x === w.geometry.y);
        const strictlyStaggered = ws.every((w, i) => i === 0 || w.geometry.x > ws[i - 1].geometry.x);
        const sameSize = ws.every((w) => w.geometry.w === ws[0].geometry.w && w.geometry.h === ws[0].geometry.h);
        return xEqualsY && strictlyStaggered && sameSize;
      })
      .toBe(true);

    // ── Maximize / restore via double-click on a window's title bar
    //    (`.qzk-plotwin-titlebar` — the documented drag surface; the title
    //    TEXT span is a `flex:1` sibling that fills the bar's whole content
    //    box, so a click must land in the bar's own PADDING strip (10px on
    //    the left — shell.css) to avoid re-targeting the rename handler
    //    instead of the bar's own maximize toggle). ─────────────────────────
    const focusedTitlebar = page.locator(".qzk-plotwin.focused .qzk-plotwin-titlebar");
    await expect(focusedTitlebar).toBeVisible();
    const focusedWinId = await page.evaluate(
      () =>
        (window as unknown as { __qz: { useApp: { getState: () => { focusedWindowId: string | null } } } }).__qz
          .useApp.getState().focusedWindowId,
    );
    expect(focusedWinId).toBeTruthy();

    await focusedTitlebar.dblclick({ position: { x: 3, y: 14 } });
    await expect
      .poll(async () => (await readWindows(page)).find((w) => w.id === focusedWinId)?.winState)
      .toBe("maximized");

    await focusedTitlebar.dblclick({ position: { x: 3, y: 14 } });
    await expect
      .poll(async () => (await readWindows(page)).find((w) => w.id === focusedWinId)?.winState)
      .toBe("normal");

    // ── Close one window via the title bar's own right-click menu (GUI_-
    //    INTERACTION #8's window menu — windowMenu.ts's "Close Window",
    //    plain no-confirm entry). ─────────────────────────────────────────
    await focusedTitlebar.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Close Window", exact: true }).click();
    await expect.poll(async () => (await readWindows(page)).length).toBe(2);
  });
});
