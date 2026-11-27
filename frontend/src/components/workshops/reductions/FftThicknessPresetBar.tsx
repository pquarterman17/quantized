// Film thickness (FFT)'s preset bar: the shared bar over its adapter. Mounted by
// FftThicknessSection through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createFftThicknessAdapter } from "./fftThicknessPresetAdapter";
import type { FftThicknessState } from "./useFftThickness";

export default function FftThicknessPresetBar({ t }: { t: FftThicknessState }) {
  return <PresetBar adapter={createFftThicknessAdapter(t)} fromResult={t.fromResult} running={t.busy} />;
}
