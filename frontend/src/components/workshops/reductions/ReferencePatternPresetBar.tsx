// XRD reference pattern's preset bar: the shared bar over its adapter. Mounted
// by ReferencePatternSection through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createReferencePatternAdapter, type ReferencePatternHandle } from "./referencePatternPresetAdapter";

export default function ReferencePatternPresetBar({ panel, running }: { panel: ReferencePatternHandle; running: boolean }) {
  return <PresetBar adapter={createReferencePatternAdapter(panel)} fromResult={false} running={running} />;
}
