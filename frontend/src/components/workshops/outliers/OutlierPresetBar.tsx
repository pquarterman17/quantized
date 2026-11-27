// Outlier screening's preset bar: the shared bar over the outlier adapter.
// Mounted by OutlierScreeningPanel through a lazy seam, so none of it is eager.
// There is no Run button (the screen follows the settings), so the Revert slot
// is never cleared by a run.

import PresetBar from "../presets/PresetBar";
import { createOutlierAdapter } from "./presetAdapter";
import type { OutlierScreeningState } from "./useOutlierScreening";

export default function OutlierPresetBar({ o, fromResult }: { o: OutlierScreeningState; fromResult: boolean }) {
  return <PresetBar adapter={createOutlierAdapter(o)} fromResult={fromResult} running={false} />;
}
