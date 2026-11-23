// The lazy half of store/windowLayout.ts: everything that needs the layout
// model (lib/windowLayout/*), behind ONE dynamic import so classic users
// download none of it and the eager slice pays for a single loader.

import { seedFromClassic, SMALL_SCREEN_PX } from "../lib/windowLayout/seed";
import { untile } from "../lib/windowLayout/narrowTile";
import { deskClassOf, isRemembered, loadLayoutTemplate, saveLayoutTemplate as saveTemplate, seedWithTemplate, type DeskClass } from "../lib/windowLayout/template";
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
 *  template for this window's width class says when there is one (plan P6, D5 "remember the last layout"). Never called for a
 *  project with a saved layout: that one always wins. */
export function seedProjectLayout(s: AppState): WindowLayoutV1 {
  const focused = s.focusedWindowId ? (`plot:${s.focusedWindowId}` as const) : null;
  return seedWithTemplate(seedLayout(s), loadLayoutTemplate(), focused);
}

/** The per-user template of the width class `width` (the window's width at the user's edit): the user's
 *  own layout edit only; never from a tiled desk (the tile is the width rule, not the user's choice, and
 *  its untiled shape is the desk of whichever class laid it out, not an edit made in this one), never the
 *  host's own upkeep (`isRemembered`). Each width class keeps its own desk, so a narrow edit
 *  never touches the wide one and the reverse (plan P6, UX pass 5 M2). */
export const saveLayoutTemplate = (layout: WindowLayoutV1, width: number = window.innerWidth): void => {
  if (layout.tiled === undefined && isRemembered(layout)) saveTemplate(untile(layout), true, deskClassOf(width));
};
/** Reset layout: the template of width class `cls` becomes the reset desk's shape outright (no merge with
 *  the old one). The caller skips it for a tiled desk (the tile is checked before the reset drops it). */
export const replaceLayoutTemplate = (layout: WindowLayoutV1, cls: DeskClass): void => saveTemplate(untile(layout), false, cls);

/** The width class of the window now. */
export const currentDeskClass = (): DeskClass => deskClassOf(typeof window === "undefined" ? SMALL_SCREEN_PX : window.innerWidth);

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
