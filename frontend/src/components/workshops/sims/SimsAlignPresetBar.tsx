// SIMS Align tab's preset bar: the shared bar over its adapter. Mounted by the
// tab through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createSimsAlignAdapter } from "./simsAlignPresetAdapter";
import type { SimsAlignState } from "./useSimsAlign";

export default function SimsAlignPresetBar({ r }: { r: SimsAlignState }) {
  return <PresetBar adapter={createSimsAlignAdapter(r)} fromResult={false} running={r.busy} />;
}
