// Inspector (right panel) drag-resize: the mirror of the Library grip. The
// panel sits on the right, so dragging LEFT (and ArrowLeft) widens it. Streams
// the clamped live width onto --rw, commits on release via `setPref`
// ("inspectorPanelWidth" -> qz.prefs). Plumbing: ../primitives/panelResize.ts.

import {
  INSPECTOR_PANEL_WIDTH_DEFAULT,
  INSPECTOR_PANEL_WIDTH_MAX,
  INSPECTOR_PANEL_WIDTH_MIN,
} from "../../store/prefs";
import { commitInspectorWidth, readInspectorWidth } from "../../store/inspectorWidth";
import { panelResizeKeys, usePanelResize, type PanelResizeSpec } from "../primitives/panelResize";

const spec: PanelResizeSpec = {
  cssVar: "--rw",
  min: INSPECTOR_PANEL_WIDTH_MIN,
  max: INSPECTOR_PANEL_WIDTH_MAX,
  dir: -1,
  read: readInspectorWidth,
  commit: commitInspectorWidth,
};

export function useInspectorResize(): (e: React.PointerEvent) => void {
  return usePanelResize(spec);
}

/** ArrowLeft widens by 16 px, ArrowRight narrows; double-click resets. */
export const inspectorResizeKeys = panelResizeKeys(spec, INSPECTOR_PANEL_WIDTH_DEFAULT);
