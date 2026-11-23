// The lazy half of store/windowLayout.ts: everything that needs the layout
// model (lib/windowLayout/*), behind ONE dynamic import so classic users
// download none of it and the eager slice pays for a single loader.

import { seedFromClassic, SMALL_SCREEN_PX } from "../lib/windowLayout/seed";
import { saveLayoutTemplate } from "../lib/windowLayout/template";
import { isLayoutTool } from "../lib/windowLayout/toolCatalog";
import type { LayoutMode, WindowLayoutV1 } from "../lib/windowLayout/types";
import { toolDockSnapshot } from "./toolDock";
import { toast } from "./toasts";
import type { AppState } from "./useApp";
import type { SliceGet, SliceSet } from "./windowLayout";

/** How long the switch-on toast stays up (it also waits while hovered or focused). */
export const WINDOW_LAYOUT_TOAST_MS = 12_000;

/** The first layout, from the classic desk (plan "Migration of existing users"). */
export function seedLayout(s: AppState): WindowLayoutV1 {
  // Plan D6: below ~1280 px wide the windows start floating, not docked.
  const small = typeof window !== "undefined" && window.innerWidth < SMALL_SCREEN_PX;
  // Only an analysis tool becomes a layout window (plan P4); another docked panel keeps its classic frame.
  const docked = toolDockSnapshot().owner;
  return seedFromClassic({ plotWindows: s.plotWindows, dockedTool: docked !== null && isLayoutTool(docked) ? docked : null }, { small });
}

export { saveLayoutTemplate };

/** store/windowLayout.ts's setLayoutMode, once this chunk is loaded. */
export function switchLayoutMode(set: SliceSet, get: SliceGet, mode: LayoutMode): LayoutMode {
  if (mode === "windows" && !get().windowLayout) set({ windowLayout: seedLayout(get()) });
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
