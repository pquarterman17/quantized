// The Inspector's width grip: a focusable vertical separator on the panel's
// left edge (the mirror of the Library's .qzk-lib-resizer). Rendered beside
// the <aside> so it does not scroll away with the Inspector's cards.

import {
  INSPECTOR_PANEL_WIDTH_MAX,
  INSPECTOR_PANEL_WIDTH_MIN,
} from "../../store/prefs";
import { useApp } from "../../store/useApp";
import { inspectorResizeKeys, useInspectorResize } from "./useInspectorResize";

export default function InspectorResizer() {
  const width = useApp((s) => s.inspectorPanelWidth);
  const startResize = useInspectorResize();
  return (
    <div
      className="qzk-insp-resizer"
      onPointerDown={startResize}
      {...inspectorResizeKeys}
      role="separator"
      tabIndex={0}
      aria-valuenow={width}
      aria-valuemin={INSPECTOR_PANEL_WIDTH_MIN}
      aria-valuemax={INSPECTOR_PANEL_WIDTH_MAX}
      aria-orientation="vertical"
      aria-label="Resize Inspector panel"
    />
  );
}
