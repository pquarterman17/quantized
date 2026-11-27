// Distribution's preset bar: the shared bar over the Distribution adapter.
// Mounted by DistributionPanel through a lazy seam, so none of it is eager.
// There is no Run button (the screen follows the settings), so the Revert slot
// is never cleared by a run.

import PresetBar from "../presets/PresetBar";
import { createDistributionAdapter } from "./presetAdapter";
import type { DistributionState } from "./useDistribution";

export default function DistributionPresetBar({ d, fromResult }: { d: DistributionState; fromResult: boolean }) {
  const adapter = createDistributionAdapter(d);
  return <PresetBar adapter={adapter} fromResult={fromResult} running={false} />;
}
