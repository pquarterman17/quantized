// The lazy half of store/windowLayout.ts: everything that needs the layout
// model (lib/windowLayout/*), behind ONE dynamic import so classic users
// download none of it and the eager slice pays for a single loader.

import { seedFromClassic, SMALL_SCREEN_PX } from "../lib/windowLayout/seed";
import { untile } from "../lib/windowLayout/narrowTile";
import { isRemembered, loadLayoutTemplate, saveLayoutTemplate as saveTemplate, seedWithTemplate } from "../lib/windowLayout/template";
import { isLayoutTool } from "../lib/windowLayout/toolCatalog";
import type { LayoutMode, WindowLayoutV1 } from "../lib/windowLayout/types";
import { toolDockSnapshot } from "./toolDock";
import { toast } from "./toasts";
import type { AppState } from "./useApp";
import type { SliceGet, SliceSet } from "./windowLayout";

/** How long the switch-on toast stays up (it also waits while hovered or focused). */
export const WINDOW_LAYOUT_TOAST_MS = 12_000;

/** Is the browser window under the D6 small-screen width? */
export const isSmallViewport = (): boolean => typeof window !== "undefined" && window.innerWidth < SMALL_SCREEN_PX;

/** The default layout for this screen width, from the classic desk (plan "Migration of existing
 *  users"): what Reset layout gives back (plan P6). */
export function seedLayout(s: AppState): WindowLayoutV1 {
  // Plan D6: below ~1280 px wide the windows start floating, not docked.
  const small = isSmallViewport();
  // Only an analysis tool becomes a layout window (plan P4); another docked panel keeps its classic frame.
  const docked = toolDockSnapshot().owner;
  return seedFromClassic({ plotWindows: s.plotWindows, dockedTool: docked !== null && isLayoutTool(docked) ? docked : null }, { small });
}

/** The layout of a project that has none of its own (a new project, an import, a file from before
 *  the window layout, a refused layout): the default seed, laid out the way the user's per-user
 *  template says when there is one (plan P6, D5 "remember the last layout"). Never called for a
 *  project with a saved layout: that one always wins. */
export function seedProjectLayout(s: AppState): WindowLayoutV1 {
  const focused = s.focusedWindowId ? (`plot:${s.focusedWindowId}` as const) : null;
  return seedWithTemplate(seedLayout(s), loadLayoutTemplate(), focused);
}

/** May this session write the per-user template? Not under the D6 small-screen width: a desk laid out
 *  there (forced floats, the small-screen seed, Float all, Reset) is not the user's wide desk, and one
 *  narrow session must never overwrite it (plan P6 provisional, UX pass 5 M2: fail-safe). */
export const canRememberDesk = (): boolean => !isSmallViewport();

/** The per-user template: the user's own layout edit, never a narrow-screen tile of it (plan P5, D6),
 *  never a narrow session's (`canRememberDesk`), never the host's own upkeep (`isRemembered`). */
export const saveLayoutTemplate = (layout: WindowLayoutV1): void => {
  if (canRememberDesk() && isRemembered(layout)) saveTemplate(untile(layout));
};
/** Reset layout: the template becomes the reset desk's shape outright (no merge with the old one), on a
 *  wide screen only (the caller skips it for a tiled desk); a narrow reset leaves the remembered desk alone. */
export const replaceLayoutTemplate = (layout: WindowLayoutV1): void => {
  if (canRememberDesk()) saveTemplate(untile(layout), false);
};

/** store/windowLayout.ts's setLayoutMode, once this chunk is loaded. */
export function switchLayoutMode(set: SliceSet, get: SliceGet, mode: LayoutMode): LayoutMode {
  if (mode === "windows" && !get().windowLayout) set({ windowLayout: seedProjectLayout(get()) });
  if (mode !== get().layoutMode) {
    get().setPref("layoutMode", mode);
    // Once per switch on (never at a reload): say how to get back, with a button for it.
    if (mode === "windows") {
      toast("Window layout is on. Switch back any time with the Classic layout button on its toolbar, or View > Panels & workspace > Window layout (preview).", "info", {
        // Long enough to read and decide (pass 2, m-4); the toast already waits while hovered or focused (store/toasts hold).
        ttlMs: WINDOW_LAYOUT_TOAST_MS,
        action: { label: "Switch back now", onClick: () => void get().setLayoutMode("classic") },
      });
    }
  }
  return mode;
}
