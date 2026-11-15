// The plot pipeline's per-series-X entry (lib/perSeriesX.ts): a dataset whose
// Ys belong to different X columns is handed to the one-X pipeline as its
// segment-concatenated view, with the view's X (`.time`, so `xKey: null`),
// the row selection repeated into every block, and `blockRows` for the
// payload (the brush's way back to source rows).
//
// Overlays (fit / baseline / peak / derivative) are NOT passed through here:
// they are built at the source's n rows, and alignOverlayY drops them against
// the view's blocks x n rows, so on a multi-X view they are dropped, never
// misdrawn. TODO(follow-up): overlays need an explicit (yKey, xKey) binding
// before they can be placed per block; guessing the owner from the live plot
// can draw a fit against the wrong X.

import { useMemo } from "react";

import { perSeriesXData, viewDataset, viewRows } from "../../lib/perSeriesX";
import { shownCurves } from "../../lib/shownCurves";
import type { Dataset } from "../../lib/types";

type Selection = { datasetId: string; rows: number[] } | null;
export function usePerSeriesX(
  active: Dataset | null | undefined,
  xKey: number | null,
  selection: Selection,
  plot: { yKeys: number[] | null; seriesOrder: number[] | null; hiddenChannels: readonly number[] },
): {
  active: Dataset | null | undefined;
  xKey: number | null;
  selection: Selection;
  blockRows: number | undefined;
} {
  const { yKeys, seriesOrder, hiddenChannels } = plot;
  // Only the SHOWN curves decide the blocks: a hidden R2 must not widen the X.
  const shown = useMemo(
    () => (active ? shownCurves(active.data, { yKeys, xKey, seriesOrder, hiddenChannels }, active.channelRoles) : []),
    [active, xKey, yKeys, seriesOrder, hiddenChannels],
  );
  // `perSeriesXData` is cached per (data, blocks), so a hide/show that leaves
  // the block set alone returns the SAME object and `view` keeps its identity.
  const built = useMemo(() => (active ? perSeriesXData(active, xKey, shown) : null), [active, xKey, shown]);
  const view = useMemo(() => (active && built ? viewDataset(active, built) : null), [active, built]);
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
