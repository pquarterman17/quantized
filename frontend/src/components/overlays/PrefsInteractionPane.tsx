// Preferences ▸ Interaction (split out of PreferencesDialog.tsx, PREFS_AUDIT
// lane 1). Lazy with the dialog.

import { interactionPrefsSlot } from "../../store/prefs";
import { useApp } from "../../store/useApp";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Switch } from "../primitives/Switch";
import PrefRow from "./PrefRow";
import { WindowLayoutPref } from "./WindowLayoutPref";

export default function PrefsInteractionPane() {
  const wheelZoom = useApp((s) => s.wheelZoom);
  const setPref = useApp((s) => s.setPref);
  const { persistentTool, menuRecents } = interactionPrefsSlot.use();
  return (
    <>
      <PrefRow label="Mouse wheel" hint="over the plot">
        <SegmentedControl
          options={["Zoom", "Off"]}
          value={wheelZoom ? "Zoom" : "Off"}
          onChange={(v) => setPref("wheelZoom", v === "Zoom")}
        />
      </PrefRow>
      <div className="qzk-pref-note">
        Drag the plot to box-zoom; double-click to autoscale. Right-click the plot, a dataset, a legend entry, or a
        worksheet column for context actions.
      </div>
      <WindowLayoutPref />
      <PrefRow label="Persistent plot tool" hint="Esc cancels a drag but keeps the tool armed, instead of returning to Pointer">
        <Switch
          aria-label="Persistent tool"
          checked={persistentTool}
          onChange={(v) => interactionPrefsSlot.save({ persistentTool: v, menuRecents })}
        />
      </PrefRow>
      <PrefRow label="Recent commands in menus" hint="list the last few commands used from each menu at its bottom">
        <Switch
          aria-label="Recent commands in menus"
          checked={menuRecents === true}
          onChange={(v) => interactionPrefsSlot.save({ persistentTool, menuRecents: v })}
        />
      </PrefRow>
    </>
  );
}
