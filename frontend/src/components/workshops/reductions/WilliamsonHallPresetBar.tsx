// Williamson-Hall's preset bar: the shared bar over its adapter. Mounted by
// WilliamsonHallSection through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createWilliamsonHallAdapter } from "./williamsonHallPresetAdapter";
import type { WilliamsonHallState } from "./useWilliamsonHall";

export default function WilliamsonHallPresetBar({ t }: { t: WilliamsonHallState }) {
  return <PresetBar adapter={createWilliamsonHallAdapter(t)} fromResult={t.fromResult} running={t.busy} />;
}
