// Optical gap's preset bar: the shared bar over its adapter. Mounted by
// OpticalGapPanel through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createOpticalGapAdapter } from "./presetAdapter";
import type { OpticalGapState } from "./useOpticalGap";

export default function OpticalGapPresetBar({ g }: { g: OpticalGapState }) {
  return <PresetBar adapter={createOpticalGapAdapter(g)} fromResult={g.fromResult} running={g.busy} />;
}
