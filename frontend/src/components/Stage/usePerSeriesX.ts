// The plot pipeline's per-series-X entry (lib/perSeriesX.ts): a dataset whose
// Ys belong to different X columns is handed to the one-X pipeline as its
// segment-concatenated view, with the view's X (`.time`, so `xKey: null`),
// the row selection repeated into every block, and `blockRows` for the
// payload (the brush's way back to source rows). The fit / baseline / peak /
// derivative overlays (built at the source's n rows, for the primary Y) are
// scattered into that Y's own block (lib/overlayBlock.ts).

import { useMemo } from "react";

import { effectiveChannels } from "../../lib/plotdata";
import { blockOverlay } from "../../lib/overlayBlock";
import { perSeriesXData, viewDataset, viewRows } from "../../lib/perSeriesX";
import { shownCurves } from "../../lib/shownCurves";
import type { FitOverlay } from "../../lib/fitTypes";
import type { BaselineOverlay, Dataset, PeakOverlay } from "../../lib/types";

type Selection = { datasetId: string; rows: number[] } | null;
interface Overlays {
  fitOverlay: FitOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  peakOverlay: PeakOverlay | null;
  derivOverlay: FitOverlay | null;
}

export function usePerSeriesX(
  active: Dataset | null | undefined,
  xKey: number | null,
  selection: Selection,
  plot: { yKeys: number[] | null; seriesOrder: number[] | null; hiddenChannels: readonly number[] } & Overlays,
): {
  active: Dataset | null | undefined;
  xKey: number | null;
  selection: Selection;
  blockRows: number | undefined;
  overlays: Overlays;
} {
  const { yKeys, seriesOrder, hiddenChannels, fitOverlay, baselineOverlay, peakOverlay, derivOverlay } = plot;
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
  const overlays = useMemo(() => {
    const primary = active ? effectiveChannels(active.data, yKeys, xKey, active.channelRoles, seriesOrder)[0] : undefined;
    const put = <T extends { y: (number | null)[]; band?: { y: (number | null)[] }[] }>(o: T | null) =>
      built ? blockOverlay(o, active, xKey, primary, built.blocks, view?.blockRows) : o;
    return { fitOverlay: put(fitOverlay), baselineOverlay: put(baselineOverlay), peakOverlay: put(peakOverlay), derivOverlay: put(derivOverlay) };
  }, [active, built, view, xKey, yKeys, seriesOrder, fitOverlay, baselineOverlay, peakOverlay, derivOverlay]);
  if (!view) return { active, xKey, selection, blockRows: undefined, overlays };
  return { active: view.dataset, xKey: null, selection: viewSelection, blockRows: view.blockRows, overlays };
}
