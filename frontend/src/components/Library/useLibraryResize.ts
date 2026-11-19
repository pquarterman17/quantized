// Library panel drag-resize (GUI_INTERACTION_PLAN #13 sub-item 5): streams the
// clamped live width onto --lw, commits on release via `setPref`. The pointer
// plumbing is shared with the Inspector grip (../primitives/panelResize.ts).

import {
  LIBRARY_PANEL_WIDTH_DEFAULT,
  LIBRARY_PANEL_WIDTH_MAX,
  LIBRARY_PANEL_WIDTH_MIN,
} from "../../store/prefs";
import { useApp } from "../../store/useApp";
import { panelResizeKeys, usePanelResize, type PanelResizeSpec } from "../primitives/panelResize";

const spec: PanelResizeSpec = {
  cssVar: "--lw",
  min: LIBRARY_PANEL_WIDTH_MIN,
  max: LIBRARY_PANEL_WIDTH_MAX,
  dir: 1,
  read: () => useApp.getState().libraryPanelWidth,
  commit: (w) => useApp.getState().setPref("libraryPanelWidth", w),
};

/** Returns the pointerdown handler for the resize handle. */
export function useLibraryResize(): (e: React.PointerEvent) => void {
  return usePanelResize(spec);
}

/** Keyboard + double-click for the separator: Left/Right step 16 px,
 *  double-click restores the first-run default width. */
export const libraryResizeKeys = panelResizeKeys(spec, LIBRARY_PANEL_WIDTH_DEFAULT);
