// The window-layout slice (WORKSPACE_LAYOUT_PLAN P0): the current project's
// dock/float layout and the switch into windows mode. Composed into the ONE
// useApp store like ./toolwindows.
//
// Eager-thin on purpose (bundle budget): this module holds state and plain
// setters only. Everything that needs the layout model loads through ONE
// dynamic import, ./windowLayoutRun, so classic users download none of it.
//
// `layoutMode` itself is a preference (`qz.prefs`, store/prefs.ts) declared on
// AppearancePrefsSlice like every other Prefs key; `setLayoutMode` here is the
// writer to use, because turning windows mode on for the first time seeds a
// layout from the classic desk.
//
// The layout is working state, never an undo step (architecture.test.ts's
// HISTORY_EXCLUDED), and it is saved with the project only while windows mode
// is on (lib/workspaceWindowLayout.ts), so a classic user's files are unchanged.

import type { LayoutMode, WindowLayoutV1 } from "../lib/windowLayout/types";
import type { AppState } from "./useApp";

export type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
export type SliceGet = () => AppState;

export interface WindowLayoutSlice {
  /** The project's window layout; null = none yet (classic, or a project
   *  saved without one). Kept when windows mode is turned off, so turning it
   *  back on restores the same desk. Null in windows mode (a project opened
   *  without a layout, Remove all, a restart) is the layout host's cue to seed
   *  one (plan P1), laid out by the per-user template when there is one (P6). */
  windowLayout: WindowLayoutV1 | null;
  /** Replace the layout (the host computes it with lib/windowLayout/ops). In
   *  windows mode its shape is also remembered as the per-user template. */
  setWindowLayout: (layout: WindowLayoutV1 | null) => void;
  /** Switch layouts. The first switch to "windows" seeds the layout from the
   *  classic desk. If the model cannot load, the mode stays classic (fail
   *  closed) and the status line says why. Resolves to the mode now in force. */
  setLayoutMode: (mode: LayoutMode) => Promise<LayoutMode>;
}

const run = () => import("./windowLayoutRun");

export function createWindowLayoutSlice(set: SliceSet, get: SliceGet): WindowLayoutSlice {
  return {
    windowLayout: null,
    setWindowLayout: (windowLayout) => {
      set({ windowLayout });
      // Bookkeeping only: a chunk that will not load just skips the template.
      // The width is read now, at the edit: the chunk loads later, and a resize meanwhile must not move the write to the other class.
      const width = typeof window === "undefined" ? undefined : window.innerWidth;
      if (windowLayout && get().layoutMode === "windows") void run().then((m) => m.saveLayoutTemplate(windowLayout, width)).catch(() => undefined);
    },
    // Fail closed: if the model will not load (or the switch throws), the mode is classic either way.
    setLayoutMode: (mode) =>
      run().then((m) => m.switchLayoutMode(set, get, mode)).catch(() => {
        if (get().layoutMode !== "classic") get().setPref("layoutMode", "classic");
        get().setStatus("Window layout failed to load; using classic.", "danger");
        return "classic" as const;
      }),
  };
}
