// Drag-to-axis (ORIGIN_GAP_PLAN #49, Graph Builder phase 1) drop handler.
// Turns an AxisDropZones drop into the store mutation(s) via the pure
// `resolveAxisDrop` decision in lib/dragaxis.ts, plus the categorical-X
// status note. Extracted from PlotStage (mirrors useQuickFitChip) so the
// drop-zone wiring doesn't grow the Stage's own line count.

import { useCallback } from "react";

import { resolveAxisDrop, type AxisZone } from "../../lib/dragaxis";
import { useActiveDataset, useApp } from "../../store/useApp";
import { toast } from "../../store/toasts";

/** The callback AxisDropZones invokes on a successful drop. Applies
 *  resolveAxisDrop's action(s) through the SAME store actions the Channels
 *  card's clicks use (setXKey/setYKeys/setY2Keys) — no new plot machinery —
 *  and surfaces the categorical-X note (GAP_PLOTTYPES #4 cross-reference) as
 *  a toast. A no-op drop (already-there, foreign dataset, role'd channel, …)
 *  is silent by design — dragging is exploratory; every miss shouldn't nag. */
export function useAxisDrop(): (zone: AxisZone, datasetId: string, channel: number) => void {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const y2Keys = useApp((s) => s.y2Keys);

  return useCallback(
    (zone, datasetId, channel) => {
      if (!active) return;
      const result = resolveAxisDrop(active, { xKey, yKeys, y2Keys }, zone, { datasetId, channel });
      const s = useApp.getState();
      for (const action of result.actions) {
        if (action.kind === "setXKey") s.setXKey(action.xKey);
        else if (action.kind === "setYKeys") s.setYKeys(action.yKeys);
        else s.setY2Keys(action.y2Keys);
      }
      if (result.categoricalXNote) toast(result.categoricalXNote, "info");
    },
    [active, xKey, yKeys, y2Keys],
  );
}
