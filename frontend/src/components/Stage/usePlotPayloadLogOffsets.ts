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
// 10^k·dy/dx. The fit / baseline / peak overlays reach the export wire
// (lib/figureSpecOverlays.ts), pre-scaled by this same first-channel factor;
// the dy/dx preview stays canvas-only.
//
// finding 8: the caller's `displayPayload` memo is the one that walks the
// full row array (O(rows)) -- `offsetsKey`, the derived per-channel offsets
// vector as a primitive string, is its stand-in dependency so a colour/
// marker-only style edit does not recompose it (see that memo's own comment
// for the exact mechanism).

import { useMemo } from "react";

import { buildErrorColumns, buildErrorSpans, type ErrorSpan } from "../../lib/errorbars";
import type { ErrorBinding } from "../../lib/errorRoles";
import {
  logOffsetDecades,
  logOffsetsApply,
  logOffsetSuffix,
  scaleErrorColumns,
  scaleErrorSpans,
} from "../../lib/logOffset";
import type { PlotPayload } from "../../lib/plotdata";
import { firstVisiblePlottedChannel } from "../../lib/quickfit";
import type { BaselineOverlay, Dataset, FitOverlay, PeakOverlay, SeriesStyle } from "../../lib/types";

export interface LogOffsetScalingParams {
  plotted: readonly number[];
  hiddenChannels: readonly number[];
  seriesStyles: Record<number, SeriesStyle>;
  waterfall: number;
  groupCol: number | null;
  /** P1.4: an encoded render never offsets (the export sends no offsets for one). */
  encoded?: boolean;
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
  const offsetsApply = logOffsetsApply(p.waterfall, p.groupCol) && !p.encoded;

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
 *  brackets moves by `10^k` (P1.5: suppressed when `grouped` -- a group or
 *  P1.4 encoding factor splits the series -- same ruling `usePlotPayload.ts`'s
 *  `colorByColumns` follows). */
export function useOffsetErrorBars(
  active: Dataset | null | undefined,
  plotted: number[],
  grouped: boolean,
  errKeys: Record<number, number>,
  seriesStyles: Record<number, SeriesStyle>,
  offsetsApply: boolean,
): Map<number, (number | null)[]> {
  return useMemo(
    () =>
      scaleErrorColumns(
        active && !grouped
          ? buildErrorColumns(active.data, plotted, errKeys)
          : new Map<number, (number | null)[]>(),
        plotted,
        seriesStyles,
        offsetsApply,
      ),
    [active, plotted, errKeys, grouped, seriesStyles, offsetsApply],
  );
}

  // #36 / G4: built from Dataset.errorRoles (the canonical contract) by
  // default — absent for a dataset with no roles, in which case the legacy
  // symmetric bars stand. G4's figure-scoped error-honesty fix: the FOCUSED
  // window's OWN document errors (`documentErrors` in usePlotPayload) become the
  // authoritative source instead, IFF they contain at least one binding the
  // legacy `errKeys` projection cannot express (`hasRichErrorBindings`) —
  // an X-error or an asymmetric `+`/`-` half. A document whose errors are
  // entirely y/both is indistinguishable from what `errKeys` already
  // carries, so it takes this branch only when there is something genuinely
  // richer to show.
  //
  // An ordinary window's document CAN be rich (corrected 2026-09-09 — the
  // previous claim that only Quick Figure / Graph Builder produce rich
  // documents was false): `createPlotWindowDocument` seeds `bindings.errors`
  // from `dataset.errorRoles`, so a parser-declared X binding makes a fresh
  // ordinary window's document rich. The invariant this branch actually relies
  // on is that dataset roles and every bound window's document errors are kept
  // in sync by the single write chokepoint in `store/importErrorRoles.ts`.
  //
  // Double-render check (investigated, not just assumed): `errorBars` above
  // is built from `p.errKeys` regardless of which path wins here, and
  // `lib/uplotOpts.ts`'s `buildOpts` already excludes any column present in
  // `errorSpans` from the legacy bars it draws
  // (`legacyBars = ...filter(([col]) => !args.errorSpans?.has(col))`, see
  // its own comment: "running both would double-draw the same whisker at a
  // different thickness"). `buildErrorSpans` itself always evaluates BOTH
  // the asymmetric-pair and symmetric-binding cases for every plotted
  // channel — so even when the document-authoritative path is active, a
  // y/both binding inside `documentErrors` still lands in the resulting
  // `errorSpans` map, gets excluded from `legacyBars` by that existing
  // filter, and draws exactly once via `errorSpansPlugin` — the identical
  // dedupe the dataset-authoritative path already relied on. No new
  // dedupe logic was needed; the existing column-based filter already
  // covers a Map built from either source.
//
// Moved here from usePlotPayload.ts (P1.4, to fund the encodings under that
// module's ceiling): `bindings` is whichever source that rule picked.
export function useOffsetErrorSpans(
  active: Dataset | null | undefined,
  plotted: number[],
  grouped: boolean,
  bindings: readonly ErrorBinding[] | undefined,
  seriesStyles: Record<number, SeriesStyle>,
  offsetsApply: boolean,
): Map<number, ErrorSpan[]> {
  return useMemo(() => {
    // P1.5: suppressed for a grouped render -- see `useOffsetErrorBars` above.
    if (!active || grouped) return new Map<number, ErrorSpan[]>();
    const spans = bindings?.length ? buildErrorSpans(active.data, plotted, bindings) : new Map<number, ErrorSpan[]>();
    return scaleErrorSpans(spans, plotted, seriesStyles, offsetsApply); // finding 3, Y half only
  }, [active, plotted, bindings, grouped, seriesStyles, offsetsApply]);
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
