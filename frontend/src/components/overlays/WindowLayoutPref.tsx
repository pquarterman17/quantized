// Preferences ▸ Interaction row: the opt-in "Window layout (preview)" switch
// (WORKSPACE_LAYOUT_PLAN P1), the same switch as View ▸ Window layout
// (preview). Turning it on the first time seeds the layout from the classic
// desk; turning it off keeps that layout, so on again restores it.

import { useApp } from "../../store/useApp";
import { Switch } from "../primitives/Switch";

export function WindowLayoutPref() {
  const on = useApp((s) => s.layoutMode === "windows");
  const setLayoutMode = useApp((s) => s.setLayoutMode);
  return (
    <div className="qzk-pref-row">
      <div className="qzk-pref-lbl">
        Window layout (preview)
        <span className="hint">the plot and Style become windows you dock to an edge or the centre, or float</span>
      </div>
      <div className="qzk-pref-ctl">
        <Switch
          aria-label="Window layout (preview)"
          checked={on}
          onChange={(next) => void setLayoutMode(next ? "windows" : "classic")}
        />
      </div>
    </div>
  );
}
