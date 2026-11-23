// Window ▸ Reset layout and its ⌘K entry (WORKSPACE_LAYOUT_PLAN P6). Layout
// changes are never undo steps (plan "Store slice and ratchets"), so the reset
// ASKS first (fail-safe, provisional: owner to confirm) instead of being one
// undo step. Confirmed, it puts back the default seed for the current screen
// width (lib/windowLayout/reset.ts says what is kept), and the per-user
// template follows, as it follows every layout change, so the next new project
// opens with the default desk too. Lazy: only the layout host's command list
// (useLayoutCommands, published while the host is mounted) imports it, so
// classic mode never shows it.

import { resetLayout } from "../lib/windowLayout/reset";
import { askConfirm } from "./confirmDialog";
import { mountedTools } from "./layoutTools";
import { useApp } from "./useApp";
import { applyLayout } from "./windowLayoutActions";

export const RESET_LAYOUT_TITLE = "Reset the window layout?";
export const RESET_LAYOUT_MESSAGE =
  "Every window goes back to its default place for this screen width, and new projects will open that way too. Open windows stay open and nothing in the project changes. A reset cannot be undone.";
export const RESET_LAYOUT_DONE = "Window layout reset to the default for this screen width.";

/** Windows mode is on with a layout (it may have been turned off, or the project replaced, while asking). */
const live = (): boolean => useApp.getState().layoutMode === "windows" && useApp.getState().windowLayout !== null;

/** Ask, then reset. `beforeWrite` runs just before the layout changes (the host holds its live-region
 *  sentence there). Resolves true when the layout was reset. */
export async function resetWindowLayout(beforeWrite?: () => void): Promise<boolean> {
  if (!(await askConfirm(RESET_LAYOUT_TITLE, RESET_LAYOUT_MESSAGE, "Reset layout")) || !live()) return false;
  const run = await import("./windowLayoutRun");
  if (!live()) return false;
  const small = run.isSmallViewport();
  beforeWrite?.();
  applyLayout((l) => resetLayout({ seed: run.seedLayout(useApp.getState()), live: l, openTools: [...mountedTools().keys()], small }));
  useApp.getState().setStatus(RESET_LAYOUT_DONE);
  return true;
}
