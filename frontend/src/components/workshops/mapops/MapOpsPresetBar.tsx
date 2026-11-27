// Map operations' preset bar: the shared bar over the Map operations adapter.
// Mounted by MapOpsPanel through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createMapOpsAdapter } from "./presetAdapter";
import type { MapOpsState } from "./useMapOps";

export default function MapOpsPresetBar({ m }: { m: MapOpsState }) {
  return <PresetBar adapter={createMapOpsAdapter({ form: m.form, setForm: m.setForm })} fromResult={false} running={m.busy} />;
}
