// Window ▸ Reset layout and its ⌘K entry (WORKSPACE_LAYOUT_PLAN P6). Layout
// changes are never undo steps (plan "Store slice and ratchets"), so the reset
// ASKS first (fail-safe, provisional: owner to confirm) instead of being one
// undo step. Confirmed, it puts back the default seed for the current screen
// width (lib/windowLayout/reset.ts says what is kept), and the per-user
// template of this width class follows, as it follows every layout change, so the next
// new project opened at this width opens with the default desk too. Lazy: only the layout host's command list
// (useLayoutCommands, published while the host is mounted) imports it, so
// classic mode never shows it.

import { resetLayout } from "../lib/windowLayout/reset";
import { SMALL_SCREEN_PX } from "../lib/windowLayout/seed";
import { askConfirm } from "./confirmDialog";
import { mountedTools } from "./layoutTools";
import { useApp } from "./useApp";
import { applyLayout } from "./windowLayoutActions";
import { onWorkspaceReplace } from "./workspaceReplace";

export const RESET_LAYOUT_TITLE = "Reset the window layout?";
const TAIL = " Open windows stay open and nothing in the project changes. A reset cannot be undone.";
/** Which width class is being reset (plan P6, UX pass 5 M2, owner-approved 2026-11-23): the desk is
 *  remembered once for windows of 1280 px and over and once for narrower ones, and a reset replaces only
 *  the class of the window it is made in. */
export const RESET_LAYOUT_MESSAGE =
  "Every window goes back to its default place for this screen width, and new projects opened in a wide window (1280 px and over) will open that way too. The desk remembered for narrow windows stays as it was." + TAIL;
export const RESET_LAYOUT_MESSAGE_NARROW =
  "Every window goes back to its default place for this screen width, and new projects opened in a narrow window (under 1280 px) will open that way too. The desk remembered for wide windows stays as it was." + TAIL;
/** While the windows are tiled by the width rule the desk is not the user's own choice, so the reset
 *  leaves both remembered desks alone. */
export const RESET_LAYOUT_MESSAGE_TILED =
  "Every window goes back to its default place for this screen width. The windows are tiled to fit this narrow window, so the desks new projects open with (wide and narrow) stay as they were." + TAIL;

const narrowNow = (): boolean => typeof window !== "undefined" && window.innerWidth < SMALL_SCREEN_PX;
const tiledNow = (): boolean => useApp.getState().windowLayout?.tiled !== undefined;
export const RESET_LAYOUT_DONE = "Window layout reset to the default for this screen width.";
export const RESET_LAYOUT_CHANGED = "The window width or tiling changed while asking; the layout is unchanged. Reset again to choose.";

/** Windows mode is on with a layout (it may have been turned off while asking). */
const live = (): boolean => useApp.getState().layoutMode === "windows" && useApp.getState().windowLayout !== null;

/** Ask, then reset. `beforeWrite` runs just before the layout changes (the host holds its live-region
 *  sentence there). Resolves true when the layout was reset. Nothing changes when the user cancels,
 *  windows mode was turned off, or the workspace was replaced (opened, restored, removed) while asking:
 *  the user confirmed resetting THAT desk, not the next project's saved one. */
export async function resetWindowLayout(beforeWrite?: () => void): Promise<boolean> {
  let replaced = false;
  const stop = onWorkspaceReplace(() => void (replaced = true));
  try {
    const askedTiled = tiledNow();
    const askedNarrow = narrowNow();
    const message = askedTiled ? RESET_LAYOUT_MESSAGE_TILED : askedNarrow ? RESET_LAYOUT_MESSAGE_NARROW : RESET_LAYOUT_MESSAGE;
    if (!(await askConfirm(RESET_LAYOUT_TITLE, message, "Reset layout")) || replaced || !live()) return false;
    const run = await import("./windowLayoutRun");
    if (replaced || !live()) return false;
    const small = run.isSmallViewport();
    const cls = run.currentDeskClass();
    const wasTiled = tiledNow();
    // The question named one width class (or the tile); a resize across 1280 px or a tile change while it
    // was open would reset a different desk than the one the user confirmed. Fail closed.
    if (wasTiled !== askedTiled || (cls === "narrow") !== askedNarrow) {
      useApp.getState().setStatus(RESET_LAYOUT_CHANGED);
      return false;
    }
    beforeWrite?.();
    applyLayout((l) => resetLayout({ seed: run.seedLayout(useApp.getState()), live: l, openTools: [...mountedTools().keys()], small, minimized: useApp.getState().plotWindows.filter((w) => w.winState === "minimized").map((w) => `plot:${w.id}` as const) }), false);
    // (applyLayout's own template write is off: the explicit, replacing write below is the only one.)
    // The template becomes the reset desk outright: a merge would keep the old tool or plot place when
    // the reset desk has no tool open or no plot window. Only the current width class's template, and
    // not from a tiled desk (the tile is checked here, before the reset drops it).
    if (!wasTiled) run.replaceLayoutTemplate(useApp.getState().windowLayout!, cls);
    useApp.getState().setStatus(RESET_LAYOUT_DONE);
    return true;
  } catch {
    useApp.getState().setStatus("Reset layout failed to load; the layout is unchanged.", "danger");
    return false;
  } finally {
    stop();
  }
}
