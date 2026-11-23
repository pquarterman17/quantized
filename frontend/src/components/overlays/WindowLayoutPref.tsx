// Preferences ▸ Interaction row: the opt-in "Window layout (preview)" switch
// (WORKSPACE_LAYOUT_PLAN P1), the same switch as View ▸ Window layout
// (preview). Turning it on the first time seeds the layout from the classic
// desk; turning it off keeps that layout, so on again restores it.
//
// While the window layout is on, a second row sets what the Data window
// follows (P3): the focused plot (default) or the Library selection. It is
// part of the layout (`windowLayout.data.follow`), so it is saved with the
// project like the rest of the desk; classic mode shows no such row.
//
// A third row (P5, owner decision D6) sets what happens on a small screen: the
// windows stay floating (the default), or they tile while the browser window is
// narrower than a chosen width, and the user's own layout comes back after
// widening. It is a per-user preference (`qz.prefs` layoutTileBelow, 0 = keep
// floating), not part of the project.

import type { DataFollow } from "../../lib/windowLayout/types";
import { useApp } from "../../store/useApp";
import BufferedNumberField from "../primitives/BufferedNumberField";
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
            // Inline on purpose: importing a layout helper here would split it into a chunk
            // shared with the layout host, which costs eager bytes (measured +36 B).
            if (follow !== layout.data.follow) setWindowLayout({ ...layout, data: { ...layout.data, follow } });
          }}
        />
      </div>
    </div>
  );
}

// Inline for the same chunk reason as above; store/prefs.ts reads the same range (tileBelow).
const TILE_DEFAULT_PX = 1280;
const TILE_MIN_PX = 600;
const TILE_MAX_PX = 3840;
const SMALL_OPTIONS: { value: "float" | "tile"; label: string }[] = [
  { value: "float", label: "Keep floating" },
  { value: "tile", label: "Tile below a width" },
];

function SmallScreenPref() {
  const on = useApp((s) => s.layoutMode === "windows");
  const below = useApp((s) => s.layoutTileBelow);
  const setPref = useApp((s) => s.setPref);
  if (!on) return null;
  return (
    <div className="qzk-pref-row">
      <div className="qzk-pref-lbl">
        Small screens
        <span className="hint">tile the windows while the browser window is narrower than this; your layout comes back when it is wider</span>
      </div>
      <div className="qzk-pref-ctl">
        <SegmentedControl
          aria-label="Small screens"
          options={SMALL_OPTIONS}
          value={below > 0 ? "tile" : "float"}
          onChange={(v) => setPref("layoutTileBelow", v === "tile" ? (below > 0 ? below : TILE_DEFAULT_PX) : 0)}
        />
        {below > 0 && (
          <BufferedNumberField
            aria-label="Tile below width (px)"
            value={below}
            min={TILE_MIN_PX}
            max={TILE_MAX_PX}
            required
            width={72}
            onValue={(v) => v !== undefined && setPref("layoutTileBelow", Math.round(v))}
          />
        )}
        {below > 0 && <span className="hint">px</span>}
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
      <SmallScreenPref />
    </>
  );
}
