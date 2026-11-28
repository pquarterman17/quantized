// Surface fit's preset bar: the shared bar over its adapter. Mounted by
// SurfaceFitPanel through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createSurfaceFitAdapter } from "./presetAdapter";
import type { SurfaceFitState } from "./useSurfaceFit";

export default function SurfaceFitPresetBar({ f }: { f: SurfaceFitState }) {
  return <PresetBar adapter={createSurfaceFitAdapter(f)} fromResult={f.fromResult} running={f.busy} />;
}
