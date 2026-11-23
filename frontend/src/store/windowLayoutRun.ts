// The lazy half of store/windowLayout.ts: everything that needs the layout
// model (lib/windowLayout/*), behind ONE dynamic import so classic users
// download none of it and the eager slice pays for a single loader.

import { seedFromClassic } from "../lib/windowLayout/seed";
import { saveLayoutTemplate } from "../lib/windowLayout/template";
import type { LayoutMode, WindowLayoutV1 } from "../lib/windowLayout/types";
import { toolDockSnapshot } from "./toolDock";
import type { AppState } from "./useApp";
import type { SliceGet, SliceSet } from "./windowLayout";

/** The first layout, from the classic desk (plan "Migration of existing users"). */
export function seedLayout(s: AppState): WindowLayoutV1 {
  return seedFromClassic({ plotWindows: s.plotWindows, dockedTool: toolDockSnapshot().owner });
}

export { saveLayoutTemplate };

/** store/windowLayout.ts's setLayoutMode, once this chunk is loaded. */
export function switchLayoutMode(set: SliceSet, get: SliceGet, mode: LayoutMode): LayoutMode {
  if (mode === "windows" && !get().windowLayout) set({ windowLayout: seedLayout(get()) });
  if (mode !== get().layoutMode) get().setPref("layoutMode", mode);
  return mode;
}
