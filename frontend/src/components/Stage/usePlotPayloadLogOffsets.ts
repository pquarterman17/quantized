// P2.3 decade offsets' overlay half, split out of usePlotPayload.ts (the
// general .ts 500-line module ceiling, RSM_CUTS_PLAN #20) -- a cohesive
// slice: everything here answers ONE question, "by how much does THIS
// offset series' own fit/baseline/peak/deriv overlay need to scale?", and
// nothing else in usePlotPayload.ts depends on its internals.
//
// finding 4 (P2.3 review): a fit/baseline/peak/deriv overlay carries no
// channel of its own -- every producer (the quick-fit gadget, curve-fit, the
// differentiate gadget) fits/derives the FIRST VISIBLE plotted channel (the
// "primary fit channel" convention `lib/quickfit.ts`'s
// `firstVisiblePlottedChannel` documents and every producer calls).
// `applyLogOffsets` (lib/logOffset.ts) only scales the BASE series it's
// handed -- an overlay is appended by `composeDisplayPayload` AFTER that, so
// without this it would stay at the unscaled magnitude while the offset
// series it's drawn against moved by `10^k`. Scaling by that same channel's
// factor here (before composing) keeps every overlay glued to its parent
// series; `derivOverlay`'s dy/dx scales identically -- d(10^k·y)/dx =
// 10^k·dy/dx. None of these overlays reach the export wire (they're
// canvas-only gadget previews), so there is nothing for export to disagree
// with once the canvas is right.
//
// finding 8: the caller's `displayPayload` memo is the one that walks the
// full row array (O(rows)) -- `offsetsKey`, the derived per-channel offsets
// vector as a primitive string, is its stand-in dependency so a colour/
// marker-only style edit does not recompose it (see that memo's own comment
// for the exact mechanism).

import { useMemo } from "react";

import { buildErrorColumns } from "../../lib/errorbars";
import { logOffsetDecades, logOffsetsApply, logOffsetSuffix, scaleErrorColumns } from "../../lib/logOffset";
import type { PlotPayload } from "../../lib/plotdata";
import { firstVisiblePlottedChannel } from "../../lib/quickfit";
import type { BaselineOverlay, Dataset, FitOverlay, PeakOverlay, SeriesStyle } from "../../lib/types";

export interface LogOffsetScalingParams {
  plotted: readonly number[];
  hiddenChannels: readonly number[];
  seriesStyles: Record<number, SeriesStyle>;
  waterfall: number;
  groupCol: number | null;
  fitOverlay: FitOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  peakOverlay: PeakOverlay | null;
  derivOverlay: FitOverlay | null;
}

export interface LogOffsetScalingResult {
  /** Whether a decade offset applies to this view at all (waterfall/group
   *  refuse it) -- shared by the base-series scaling `applyLogOffsets`
   *  itself does and every overlay/error scaling this hook and its caller
   *  do alongside it. */
  offsetsApply: boolean;
  /** The derived per-`plotted`-channel offsets, as a primitive string --
   *  finding 8's stand-in dependency for the caller's expensive memo. */
  offsetsKey: string;
  scaledFitOverlay: FitOverlay | null;
  scaledBaselineOverlay: BaselineOverlay | null;
  scaledPeakOverlay: PeakOverlay | null;
  scaledDerivOverlay: FitOverlay | null;
}

/** Scale an overlay's `y` by `factor` -- a MODULE-level pure function, not a
 *  closure, so the `useMemo`s below can list `overlayFactor` as their only
 *  real dependency instead of a freshly-recreated-every-render helper.
 *  `factor === 1` (no offset, or no overlay) returns `overlay` itself
 *  unchanged. */
function scaleOverlay<T extends { y: (number | null)[] } | null>(overlay: T, factor: number): T {
  if (!overlay || factor === 1) return overlay;
  return { ...overlay, y: overlay.y.map((v) => (v == null ? v : v * factor)) };
}

export function useLogOffsetScaling(p: LogOffsetScalingParams): LogOffsetScalingResult {
  const offsetsApply = logOffsetsApply(p.waterfall, p.groupCol);

  const offsetsKey = useMemo(
    () => p.plotted.map((ch) => logOffsetDecades(p.seriesStyles[ch]?.logOffset)).join(","),
    [p.plotted, p.seriesStyles],
  );

  const overlayFactor = useMemo(() => {
    if (!offsetsApply) return 1;
    const ch = firstVisiblePlottedChannel(p.plotted, (c) => p.hiddenChannels.includes(c));
    return ch === null ? 1 : 10 ** logOffsetDecades(p.seriesStyles[ch]?.logOffset);
  }, [offsetsApply, p.plotted, p.hiddenChannels, p.seriesStyles]);

  const scaledFitOverlay = useMemo(() => scaleOverlay(p.fitOverlay, overlayFactor), [p.fitOverlay, overlayFactor]);
  const scaledBaselineOverlay = useMemo(
    () => scaleOverlay(p.baselineOverlay, overlayFactor),
    [p.baselineOverlay, overlayFactor],
  );
  const scaledPeakOverlay = useMemo(() => scaleOverlay(p.peakOverlay, overlayFactor), [p.peakOverlay, overlayFactor]);
  const scaledDerivOverlay = useMemo(
    () => scaleOverlay(p.derivOverlay, overlayFactor),
    [p.derivOverlay, overlayFactor],
  );

  return { offsetsApply, offsetsKey, scaledFitOverlay, scaledBaselineOverlay, scaledPeakOverlay, scaledDerivOverlay };
}

/** Finding 3: `buildErrorColumns`' magnitudes, scaled by each channel's own
 *  decade offset -- built from the RAW dataset, so without this an offset
 *  series' whisker would stay at the true magnitude while the point it
 *  brackets moves by `10^k` (P1.5: suppressed when grouped, same ruling
 *  `usePlotPayload.ts`'s `colorByColumns` follows). */
export function useOffsetErrorBars(
  active: Dataset | null | undefined,
  plotted: number[],
  groupCol: number | null,
  errKeys: Record<number, number>,
  seriesStyles: Record<number, SeriesStyle>,
  offsetsApply: boolean,
): Map<number, (number | null)[]> {
  return useMemo(
    () =>
      scaleErrorColumns(
        active && groupCol === null
          ? buildErrorColumns(active.data, plotted, errKeys)
          : new Map<number, (number | null)[]>(),
        plotted,
        seriesStyles,
        offsetsApply,
      ),
    [active, plotted, errKeys, groupCol, seriesStyles, offsetsApply],
  );
}

/** Finding 6: a legend rename is used VERBATIM by the renderer
 *  (`uplotOpts.buildOpts`), so it needs the SAME " ×10^k" disclosure the
 *  auto-derived label already carries via `applyLogOffsets` -- mirrors the
 *  export's `apply_offset_disclosure_to_renames`. */
export function useOffsetLabelList(
  displayPayload: PlotPayload | null,
  plotted: readonly number[],
  seriesLabels: Record<number, string>,
  seriesStyles: Record<number, SeriesStyle>,
  offsetsApply: boolean,
): (string | undefined)[] | undefined {
  return useMemo(() => {
    if (!displayPayload) return undefined;
    return displayPayload.series.map((_, i) => {
      if (i >= plotted.length) return undefined;
      const ch = plotted[i];
      const label = seriesLabels[ch];
      if (label === undefined) return undefined;
      const k = offsetsApply ? logOffsetDecades(seriesStyles[ch]?.logOffset) : 0;
      return k ? label + logOffsetSuffix(k) : label;
    });
  }, [displayPayload, plotted, seriesLabels, seriesStyles, offsetsApply]);
}
