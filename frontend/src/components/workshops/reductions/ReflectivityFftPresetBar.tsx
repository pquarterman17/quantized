// Reflectivity FFT's preset bar: the shared bar over its adapter. Mounted by
// ReflectivityFftSection through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createReflectivityFftAdapter } from "./reflectivityFftPresetAdapter";
import type { ReflectivityFftState } from "./useReflectivityFft";

export default function ReflectivityFftPresetBar({ t }: { t: ReflectivityFftState }) {
  return <PresetBar adapter={createReflectivityFftAdapter(t)} fromResult={t.fromResult} running={t.busy} />;
}
