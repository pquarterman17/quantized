// SIMS Compare tab's preset bar: the shared bar over its adapter. Mounted by the
// tab through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createSimsCompareAdapter } from "./simsComparePresetAdapter";
import type { SimsCompareState } from "./useSimsCompare";

export default function SimsComparePresetBar({ r }: { r: SimsCompareState }) {
  return <PresetBar adapter={createSimsCompareAdapter(r)} fromResult={false} running={r.busy} />;
}
