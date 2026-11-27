// Statistical tests' preset bar: the shared bar over the stats-tests adapter.
// Mounted by StatsTestsPanel through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createStatsTestsAdapter } from "./presetAdapter";
import type { StatsTestsState } from "./useStatsTests";

export default function StatsTestsPresetBar({ t, fromResult }: { t: StatsTestsState; fromResult: boolean }) {
  return <PresetBar adapter={createStatsTestsAdapter(t)} fromResult={fromResult} running={t.busy} />;
}
