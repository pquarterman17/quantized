// Time series' preset bar: the shared bar over the Time series adapter.
// Mounted by TimeSeriesPanel through a lazy seam, so none of it is eager.

import PresetBar from "../presets/PresetBar";
import { createTimeSeriesAdapter } from "./presetAdapter";
import type { TimeSeriesState } from "./useTimeSeries";

export default function TimeSeriesPresetBar({ t, fromResult }: { t: TimeSeriesState; fromResult: boolean }) {
  return <PresetBar adapter={createTimeSeriesAdapter(t)} fromResult={fromResult} running={t.busy} />;
}
