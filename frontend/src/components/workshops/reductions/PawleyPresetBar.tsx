// Pawley refinement's preset bar: the shared bar over its adapter. Mounted by
// PawleySection through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createPawleyAdapter } from "./pawleyPresetAdapter";
import type { PawleyState } from "./usePawley";

export default function PawleyPresetBar({ s }: { s: PawleyState }) {
  return <PresetBar adapter={createPawleyAdapter(s)} fromResult={s.fromResult} running={s.busy} />;
}
