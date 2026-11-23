// The lazy half of store/windowLayout.ts: everything that needs the layout
// model (lib/windowLayout/*), behind ONE dynamic import so classic users
// download none of it and the eager slice pays for a single loader.

import { seedFromClassic, SMALL_SCREEN_PX } from "../lib/windowLayout/seed";
import { saveLayoutTemplate } from "../lib/windowLayout/template";
import type { LayoutMode, WindowLayoutV1 } from "../lib/windowLayout/types";
import { toolDockSnapshot } from "./toolDock";
import { toast } from "./toasts";
import type { AppState } from "./useApp";
import type { SliceGet, SliceSet } from "./windowLayout";

/** The first layout, from the classic desk (plan "Migration of existing users"). */
export function seedLayout(s: AppState): WindowLayoutV1 {
  // Plan D6: below ~1280 px wide the windows start floating, not docked.
  const small = typeof window !== "undefined" && window.innerWidth < SMALL_SCREEN_PX;
  return seedFromClassic({ plotWindows: s.plotWindows, dockedTool: toolDockSnapshot().owner }, { small });
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
        action: { label: "Switch back now", onClick: () => void get().setLayoutMode("classic") },
      });
    }
  }
  return mode;
}
