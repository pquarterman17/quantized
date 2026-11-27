// Hysteresis' preset bar: the shared bar over the Hysteresis adapter (the trend
// axis of a comparison). Mounted by HysteresisBatchSection through a lazy seam,
// so none of it is eager. The batch runs inside the shared batch controls, which
// do not report a running state, so the Revert slot lasts until the panel closes.

import PresetBar from "../presets/PresetBar";
import { createHysteresisAdapter, type HysteresisAxisHandle } from "./presetAdapter";

export default function HysteresisPresetBar({ axis }: { axis: HysteresisAxisHandle }) {
  return <PresetBar adapter={createHysteresisAdapter(axis)} fromResult={false} running={false} />;
}
