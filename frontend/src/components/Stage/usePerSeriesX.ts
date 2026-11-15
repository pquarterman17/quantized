// The plot pipeline's per-series-X entry (lib/perSeriesX.ts): a dataset whose
// Ys belong to different X columns is handed to the one-X pipeline as its
// segment-concatenated view, with the view's X (`.time`, so `xKey: null`),
// the row selection repeated into every block, and `blockRows` for the
// payload (the brush's way back to source rows).

import { useMemo } from "react";

import { effectiveChannels } from "../../lib/plotdata";
import { perSeriesXDataset, viewRows } from "../../lib/perSeriesX";
import type { Dataset } from "../../lib/types";

type Selection = { datasetId: string; rows: number[] } | null;

export function usePerSeriesX(
  active: Dataset | null | undefined,
  xKey: number | null,
  selection: Selection,
  plot: { yKeys: number[] | null; seriesOrder: number[] | null; hiddenChannels: readonly number[] },
): { active: Dataset | null | undefined; xKey: number | null; selection: Selection; blockRows: number | undefined } {
  const { yKeys, seriesOrder, hiddenChannels } = plot;
  // Only the SHOWN curves decide the blocks: a hidden R2 must not widen the X.
  const shown = useMemo(
    () => (active ? effectiveChannels(active.data, yKeys, xKey, active.channelRoles, seriesOrder).filter((c) => !hiddenChannels.includes(c)) : []),
    [active, xKey, yKeys, seriesOrder, hiddenChannels],
  );
  const view = useMemo(() => (active ? perSeriesXDataset(active, xKey, shown) : null), [active, xKey, shown]);
  const viewSelection = useMemo(
    () =>
      view && selection
        ? { ...selection, rows: viewRows(selection.rows, view.dataset.data.time.length / view.blockRows, view.blockRows) }
        : selection,
    [view, selection],
  );
  if (!view) return { active, xKey, selection, blockRows: undefined };
  return { active: view.dataset, xKey: null, selection: viewSelection, blockRows: view.blockRows };
}
