// Preferences ▸ Interaction row: the opt-in "Window layout (preview)" switch
// (WORKSPACE_LAYOUT_PLAN P1), the same switch as View ▸ Window layout
// (preview). Turning it on the first time seeds the layout from the classic
// desk; turning it off keeps that layout, so on again restores it.
//
// While the window layout is on, a second row sets what the Data window
// follows (P3): the focused plot (default) or the Library selection. It is
// part of the layout (`windowLayout.data.follow`), so it is saved with the
// project like the rest of the desk; classic mode shows no such row.

import { setDataFollow } from "../../lib/windowLayout/dataSource";
import type { DataFollow } from "../../lib/windowLayout/types";
import { useApp } from "../../store/useApp";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Switch } from "../primitives/Switch";

const FOLLOW_OPTIONS: { value: DataFollow["follow"]; label: string }[] = [
  { value: "plot", label: "Focused plot" },
  { value: "library", label: "Library selection" },
];

function DataFollowPref() {
  const layout = useApp((s) => (s.layoutMode === "windows" ? s.windowLayout : null));
  const setWindowLayout = useApp((s) => s.setWindowLayout);
  if (!layout) return null;
  return (
    <div className="qzk-pref-row">
      <div className="qzk-pref-lbl">
        Data window follows
        <span className="hint">which dataset the Data window shows while it is not pinned</span>
      </div>
      <div className="qzk-pref-ctl">
        <SegmentedControl
          aria-label="Data window follows"
          options={FOLLOW_OPTIONS}
          value={layout.data.follow}
          onChange={(follow) => {
            const next = setDataFollow(layout, follow);
            if (next !== layout) setWindowLayout(next);
          }}
        />
      </div>
    </div>
  );
}

export function WindowLayoutPref() {
  const on = useApp((s) => s.layoutMode === "windows");
  const setLayoutMode = useApp((s) => s.setLayoutMode);
  return (
    <>
      <div className="qzk-pref-row">
        <div className="qzk-pref-lbl">
          Window layout (preview)
          <span className="hint">the plot, Data and Style become windows you dock to an edge or the centre, or float</span>
        </div>
        <div className="qzk-pref-ctl">
          <Switch
            aria-label="Window layout (preview)"
            checked={on}
            onChange={(next) => void setLayoutMode(next ? "windows" : "classic")}
          />
        </div>
      </div>
      <DataFollowPref />
    </>
  );
}
