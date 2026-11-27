// Design of experiments' preset bar: the shared bar over the DOE adapter.
// Mounted by DoePanel through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createDoeAdapter } from "./presetAdapter";
import type { DoeState } from "./useDoe";

export default function DoePresetBar({ d }: { d: DoeState }) {
  return <PresetBar adapter={createDoeAdapter({ setup: d.setup, update: d.update })} fromResult={d.fromResult} running={d.busy} />;
}
