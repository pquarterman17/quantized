// The lazy half of store/windowLayout.ts: everything that needs the layout
// model (lib/windowLayout/*), behind ONE dynamic import so classic users
// download none of it and the eager slice pays for a single loader.

import { seedFromClassic, SMALL_SCREEN_PX } from "../lib/windowLayout/seed";
import { saveLayoutTemplate } from "../lib/windowLayout/template";
import type { LayoutMode, WindowLayoutV1 } from "../lib/windowLayout/types";
import { seedPlotWidth } from "../lib/windowLayout/visibility";
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
  return seedFromClassic({ plotWindows: s.plotWindows, dockedTool: toolDockSnapshot().owner }, { small });
}

/** Small desk: narrow each floating plot so the floating Style window beside it leaves its title bar and
 *  buttons clear (UX pass 2, M1). Geometry only; a plot the user already moved or sized stays within the
 *  new width at most, never grows. */
function fitSeededPlots(set: SliceSet, get: SliceGet): void {
  const lib = document.querySelector(".qzk-library")?.getBoundingClientRect();
  const deskWidth = window.innerWidth - (get().leftCollapsed ? 28 : (lib?.width ?? 0));
  const floating = new Set(get().windowLayout?.z ?? []);
  set({
    plotWindows: get().plotWindows.map((w) =>
      floating.has(`plot:${w.id}`) ? { ...w, winState: w.winState === "maximized" ? "normal" : w.winState, geometry: { ...w.geometry, w: seedPlotWidth(deskWidth, w.geometry.x, w.geometry.w) } } : w,
    ),
  });
}

export { saveLayoutTemplate };

/** store/windowLayout.ts's setLayoutMode, once this chunk is loaded. */
export function switchLayoutMode(set: SliceSet, get: SliceGet, mode: LayoutMode): LayoutMode {
  if (mode === "windows" && !get().windowLayout) {
    set({ windowLayout: seedLayout(get()) });
    if (window.innerWidth < SMALL_SCREEN_PX) fitSeededPlots(set, get);
  }
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
