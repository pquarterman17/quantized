// The row window a snapshot of `producerId` on `active` would be SAVED under, reactive: the tool panel keys its live
// result with it (lib/snapshotResultKey `rangedSnapshotKey`, the function the save also builds its key with), so a save
// under a range reads "Saved" afterwards, and clearing the range reads "Not saved" for the unranged question.
// `snapshotSaveRange` is the save's own range (producers that do not read a range get none; a range whose rows are
// gone is refused there and reads as none here).

import type { RowRange } from "../../../lib/rowRange";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { snapshotSaveRange } from "../../../store/savedRowRange";

export function useSavedRowRange(producerId: string, active: Dataset | null): RowRange | null {
  // Re-render when the shared selection's window on this sheet changes; the value itself comes from the save's reader.
  useAnalysisSelection((s) => {
    const r = s.selection?.items.find((item) => item.datasetId === active?.id)?.rowRange;
    return r ? `${r.from}:${r.to}:${r.was ?? ""}` : "";
  });
  return active && !active.pending ? snapshotSaveRange(producerId, active, "this result").range : null;
}
