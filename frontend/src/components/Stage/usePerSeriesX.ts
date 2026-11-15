// The plot pipeline's per-series-X entry (lib/perSeriesX.ts): a dataset whose
// Ys belong to different X columns is handed to the one-X pipeline as its
// segment-concatenated view, with the view's X (`.time`, so `xKey: null`),
// the row selection repeated into every block, and `blockRows` for the
// payload (the brush's way back to source rows).
//
// Overlays (fit / baseline / peak / derivative) are built at the source's n
// rows for the ONE curve their binding names; on a view each is placed into
// its bound X's block by lib/overlayPlacement.ts -- the same placement the
// figure export uses -- and fails closed (not drawn) when that block is not
// in the view. On a one-X sheet every overlay passes through untouched.

import { useEffect, useMemo, useState } from "react";

import { curveX, perSeriesXData, viewDataset, viewRows } from "../../lib/perSeriesX";
import { shownCurves } from "../../lib/shownCurves";
import type { BaselineOverlay, Dataset, FitOverlay, PeakOverlay } from "../../lib/types";

// LAZY: the placement matters only on a multi-X view, so lib/overlayPlacement
// loads through a dynamic import the first time one is shown. Until it
// resolves a multi-X view draws NO overlay (fail closed, never a misplaced
// one); a one-X sheet never waits and never loads it.
type PlacementModule = typeof import("../../lib/overlayPlacement");
let placementLoaded: PlacementModule | null = null;
let placementLoading: Promise<PlacementModule> | null = null;
function usePlacementModule(wanted: boolean): PlacementModule | null {
  const [mod, setMod] = useState<PlacementModule | null>(placementLoaded);
  useEffect(() => {
    if (!wanted || mod) return;
    let live = true;
    placementLoading ??= import("../../lib/overlayPlacement").then((m) => (placementLoaded = m));
    void placementLoading.then((m) => {
      if (live) setMod(m);
    });
    return () => {
      live = false;
    };
  }, [wanted, mod]);
  return mod;
}

type Layout = ReturnType<PlacementModule["overlayLayout"]>;
function placeFor<T extends Parameters<PlacementModule["placeOverlay"]>[0]>(
  o: T,
  multiX: boolean,
  placement: PlacementModule | null,
  layout: Layout,
): T {
  if (!multiX) return o;
  return placement ? (placement.placeOverlay(o, layout) as T) : (null as T);
}

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
  /** The overlays as this view draws them (each in its bound block). */
  overlays: Overlays;
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
  // `built` keeps its identity across renames/exclusion toggles, and a
  // placement is cached per (overlay, layout key): unrelated edits re-place nothing.
  const multiX = useMemo(
    () => !!active && (!!built || curveX(active, xKey).some((x) => x !== undefined && x !== xKey)),
    [active, xKey, built],
  );
  const placement = usePlacementModule(multiX);
  const layout = useMemo(
    () => (active && placement ? placement.overlayLayout(active, xKey, built?.blocks) : null),
    [active, xKey, built, placement],
  );
  const { fitOverlay: f, baselineOverlay: b, peakOverlay: pk, derivOverlay: d } = plot;
  const overlays = useMemo(
    () => ({
      fitOverlay: placeFor(f, multiX, placement, layout),
      baselineOverlay: placeFor(b, multiX, placement, layout),
      peakOverlay: placeFor(pk, multiX, placement, layout),
      derivOverlay: placeFor(d, multiX, placement, layout),
    }),
    [f, b, pk, d, multiX, placement, layout],
  );
  if (!view) return { active, xKey, selection, blockRows: undefined, overlays };
  return { active: view.dataset, xKey: null, selection: viewSelection, blockRows: view.blockRows, overlays };
}
