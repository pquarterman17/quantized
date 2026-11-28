// SIMS Region tab's preset bar: the shared bar over its adapter. Mounted by the
// tab through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createSimsRegionAdapter } from "./simsRegionPresetAdapter";
import type { SimsRegionState } from "./useSimsRegion";

export default function SimsRegionPresetBar({ r }: { r: SimsRegionState }) {
  return <PresetBar adapter={createSimsRegionAdapter(r)} fromResult={false} running={r.busy} />;
}
