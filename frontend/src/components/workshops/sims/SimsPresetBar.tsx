// SIMS depth profile's preset bar: the shared bar over the SIMS adapter.
// Mounted by the Process tab through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createSimsAdapter } from "./presetAdapter";
import type { SimsState } from "./useSims";

export default function SimsPresetBar({ r }: { r: SimsState }) {
  return <PresetBar adapter={createSimsAdapter({ form: r.form, labels: r.labels, setForm: r.setForm })} fromResult={false} running={r.busy} />;
}
