// The plot's data pipeline: fetch → categorical-x remap → display-compose
// (waterfall → exclusion mask → fit/baseline/peak/deriv overlays → selection
// brush), plus the per-channel style/label/error/hidden mappings the render
// core (PlotViewport) needs. Split out of PlotStage.tsx (MULTI_PLOT_PLAN item 1
// / PROJECT_ORGANIZATION_PLAN #10): a plain hook over EXPLICIT params rather
// than store reads, so the same pipeline can later feed a background window's
// viewport from a `PlotView` snapshot (item 4) instead of the live singleton
// fields, with no change to this file. Rows are read through lib/rowstate
// ONLY (architecture guard #50/#53 — `droppedRows` folds manual exclusion and
// the local filter into one dropped-row set).

import { useEffect, useMemo, useRef, useState } from "react";

import { buildColorByColumns, type ColorScatterSpec } from "../../lib/colorscatter";
import { buildErrorColumns, buildErrorSpans, type ErrorSpan } from "../../lib/errorbars";
import { hasRichErrorBindings, type ErrorBinding } from "../../lib/errorRoles";
import { channelModelingType } from "../../lib/modeling";
import {
  categoricalXPayload,
  composeDisplayPayload,
  effectiveChannels,
  fetchPlot,
  type PlotPayload,
} from "../../lib/plotdata";
import {
  DECIMATE_MIN_POINTS,
  decimationRequestEligible,
  defaultDecimateWidthHint,
  shouldRefetchWindow,
} from "../../lib/plotDecimate";
import { droppedRows } from "../../lib/rowstate";
import type { AxisScale, BaselineOverlay, Dataset, FitOverlay, PeakOverlay, SeriesStyle } from "../../lib/types";

export interface PlotPayloadParams {
  active: Dataset | null | undefined;
  yScale: AxisScale;
  xScale: AxisScale;
  xKey: number | null;
  yKeys: number[] | null;
  y2Keys: number[] | null;
  seriesOrder: number[] | null;
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  errKeys: Record<number, number>;
  /** G4 figure-scoped error honesty: the FOCUSED window's document errors
   *  (`FigureDocument.bindings.errors`), threaded in alongside `errKeys` so
   *  `errorSpans` below can prefer them over `active.errorRoles` when they
   *  carry something the legacy `errKeys` projection cannot express (see
   *  `hasRichErrorBindings`). Undefined (every caller that doesn't thread a
   *  document -- background/panel windows) behaves exactly like today: the
   *  dataset's own `errorRoles` decide. */
  documentErrors?: readonly ErrorBinding[];
  hiddenChannels: number[];
  waterfall: number;
  excludedDisplay: "hide" | "grey";
  fitOverlay: FitOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  peakOverlay: PeakOverlay | null;
  derivOverlay: FitOverlay | null;
  selection: { datasetId: string; rows: number[] } | null;
  /** Current line/scatter/step trace mode (PlotViewport's own prop, threaded
   *  here too — P3.4) — Scatter disqualifies a server-decimation request the
   *  same way it disqualifies the client-side path (see plotDecimate.ts's
   *  decimationRequestEligible). Undefined defaults to "Line" (eligible). */
  defaultTrace?: string;
  /** Committed X view limits — the store's `xLim` (P3.4 zoom-refetch
   *  residual). When the currently loaded BASE payload came back
   *  server-decimated, a committed zoom/pan (this changing to a non-null
   *  window) triggers a follow-up windowed re-fetch so the visible range
   *  recovers full local detail instead of showing only the envelope the
   *  full-range decimation kept. `null` (autoscale/reset — also every
   *  pre-existing caller that omits this prop) shows the cached full-range
   *  payload with NO extra fetch. */
  xLim?: [number, number] | null;
}

/** Would ANY overlay/selection/exclusion companion be appended onto the base
 *  fetch by `composeDisplayPayload`? Those are always built at the dataset's
 *  FULL row count, so a server-decimated (reduced) base cannot safely carry
 *  one — `lib/plotdata.ts`'s `alignOverlayY` would otherwise be asked to
 *  align a full-length column onto a sparse row set (see its P3.4 doc). Takes
 *  each input explicitly (rather than the whole params object) so the fetch
 *  effect's dependency array below can list exactly what this reads — every
 *  one of them IS a listed dependency, so toggling an overlay ON while a
 *  decimated payload is showing triggers a fresh, full-resolution fetch
 *  instead of leaving the overlay silently unaligned. */
function hasOverlayCompanions(args: {
  fitOverlay: FitOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  peakOverlay: PeakOverlay | null;
  derivOverlay: FitOverlay | null;
  selection: { datasetId: string; rows: number[] } | null;
  excludedDisplay: "hide" | "grey";
  activeId: string;
  dropped: Set<number>;
}): boolean {
  if (args.fitOverlay?.datasetId === args.activeId) return true;
  if (args.baselineOverlay?.datasetId === args.activeId) return true;
  if (args.peakOverlay?.datasetId === args.activeId) return true;
  if (args.derivOverlay?.datasetId === args.activeId) return true;
  if (args.selection?.datasetId === args.activeId) return true;
  if (args.excludedDisplay === "grey" && args.dropped.size > 0) return true;
  return false;
}

export interface PlotPayloadResult {
  /** The raw fetched payload (pre-compose) — most consumers want
   *  `displayPayload` instead; kept for anything that needs the un-composed
   *  series (e.g. a future background viewport building its own compose). */
  payload: PlotPayload | null;
  /** The fully composed, drawable payload — what PlotViewport renders. */
  displayPayload: PlotPayload | null;
  /** Value-channel indices actually plotted, in draw order. */
  plotted: number[];
  /** Per-display-series style overrides, aligned 1:1 with `displayPayload.series`. */
  styleList: (SeriesStyle | undefined)[] | undefined;
  /** Per-display-series legend-rename overrides, aligned 1:1 with `displayPayload.series`. */
  labelList: (string | undefined)[] | undefined;
  /** Error-bar magnitudes keyed by uPlot data-column index (1-based). */
  errorBars: Map<number, (number | null)[]>;
  /** MAIN #36: asymmetric / X error spans from the canonical role bindings. */
  errorSpans: Map<number, ErrorSpan[]>;
  /** Colour-mapped-scatter specs (MAIN #14) keyed by uPlot data-column index. */
  colorByColumns: Map<number, ColorScatterSpec>;
  /** Per-display-series visibility (interactive legend), aligned 1:1 with `displayPayload.series`. */
  hidden: boolean[] | undefined;
}

/** Fetch + compose the active dataset's plot payload and its per-channel
 *  style/label/error/hidden mappings. Re-fetches whenever the active dataset,
 *  scale, or plotted-channel selection changes; re-composes (no re-fetch)
 *  whenever an overlay, the waterfall offset, the exclusion mode, or the row
 *  selection changes. */
export function usePlotPayload(p: PlotPayloadParams): PlotPayloadResult {
  const { active } = p;
  const [payload, setPayload] = useState<PlotPayload | null>(null);

  // G4 review round (P1 fix): whether the focused window's OWN document
  // errors are rich enough to be the AUTHORITATIVE errorSpans source (see
  // the `errorSpans` useMemo below for the full rule). Hoisted above both
  // the fetch effect and that useMemo so the fetch effect's decimation gate
  // can see it too -- it used to read ONLY `active.errorRoles?.length`,
  // which stayed blind to a document carrying rich errors on a dataset
  // whose OWN `errorRoles` were empty. A big (>10k-row) window in that state
  // passed the decimation gate: the server returned a bucketed payload while
  // `buildErrorSpans` built FULL-resolution magnitude arrays, and
  // `errorSpansPlugin` (uplotOverlays.ts) indexes those positionally against
  // the bucketed xs -- silently wrong uncertainty bars, exactly the
  // misalignment `lib/plotDecimate.ts`'s own doc comment on error bars
  // warns about.
  const useDocumentErrors = hasRichErrorBindings(p.documentErrors);

  // P3.4 zoom-refetch residual: the full-range payload the BASE fetch effect
  // below last resolved, cached so a reset-to-full-view (xLim -> null) can
  // restore it with NO extra network round trip, and so the windowed-refetch
  // effect further below can rebuild the SAME decimate-width hint the base
  // fetch used ("the same width hint" — not a fresh `window.innerWidth`
  // read, in case the window resized in between). A plain ref, not state: it
  // must be readable inside the windowed effect WITHOUT being one of that
  // effect's own dependencies — see that effect's own comment for why (a
  // fetch feedback loop).
  const basePayloadRef = useRef<PlotPayload | null>(null);
  const decimateWidthRef = useRef<number | null>(null);
  // Whether the CURRENT base payload was server-decimated — a plain boolean
  // derived from the base fetch's own response (never re-derived from the
  // client-side eligibility heuristic; see shouldRefetchWindow's doc). Kept
  // as STATE (not folded into the ref above) specifically so it can be a
  // dependency of the windowed effect: a committed zoom that arrives BEFORE
  // the base fetch resolves must still fire its windowed fetch the moment
  // the base does resolve, and only a reactive dependency guarantees that
  // re-run (a ref write alone triggers nothing).
  const [baseDecimated, setBaseDecimated] = useState(false);

  // Rows dropped from the plot: manually excluded (#50) ∪ filter-failed (#53).
  const dropped = useMemo(() => droppedRows(active), [active]);

  // Channels actually drawn (y selection minus the x-axis channel), in order.
  const plotted = useMemo(
    () =>
      active ? effectiveChannels(active.data, p.yKeys, p.xKey, active.channelRoles, p.seriesOrder) : [],
    [active, p.yKeys, p.xKey, p.seriesOrder],
  );

  // Fold overlays + exclusion mask + selection brush in (see composeDisplayPayload).
  const displayPayload = useMemo(
    () =>
      payload
        ? composeDisplayPayload(payload, {
            id: active?.id ?? null,
            waterfall: p.waterfall,
            dropped,
            excludedDisplay: p.excludedDisplay,
            fitOverlay: p.fitOverlay,
            baselineOverlay: p.baselineOverlay,
            peakOverlay: p.peakOverlay,
            derivOverlay: p.derivOverlay,
            selection: p.selection,
          })
        : null,
    [
      payload,
      p.fitOverlay,
      p.peakOverlay,
      p.baselineOverlay,
      p.derivOverlay,
      p.waterfall,
      active,
      dropped,
      p.excludedDisplay,
      p.selection,
    ],
  );

  // Map each display-series back to its dataset channel so the per-channel style
  // overrides land on the right line. Plotted channels come first (in yKeys order,
  // matching the backend), overlays after — those get `undefined` (defaults).
  const styleList = useMemo(() => {
    if (!displayPayload) return undefined;
    return displayPayload.series.map((_, i) => (i < plotted.length ? p.seriesStyles[plotted[i]] : undefined));
  }, [displayPayload, plotted, p.seriesStyles]);

  // Legend-rename overrides, aligned 1:1 with the display series (overlays keep
  // their default labels).
  const labelList = useMemo(() => {
    if (!displayPayload) return undefined;
    return displayPayload.series.map((_, i) => (i < plotted.length ? p.seriesLabels[plotted[i]] : undefined));
  }, [displayPayload, plotted, p.seriesLabels]);

  // Error-bar magnitudes per plotted series (keyed by uPlot data column = p+1).
  const errorBars = useMemo(
    () =>
      active ? buildErrorColumns(active.data, plotted, p.errKeys) : new Map<number, (number | null)[]>(),
    [active, plotted, p.errKeys],
  );

  // Colour-mapped-scatter specs per plotted series (MAIN #14), same p+1 keying.
  const colorByColumns = useMemo(
    () =>
      active
        ? buildColorByColumns(active.data, plotted, p.seriesStyles)
        : new Map<number, ColorScatterSpec>(),
    [active, plotted, p.seriesStyles],
  );

  // Interactive-legend visibility, aligned 1:1 with the display series (overlays
  // — index ≥ plotted.length — are never hidden).
  const hidden = useMemo(
    () =>
      displayPayload?.series.map((_, i) => i < plotted.length && p.hiddenChannels.includes(plotted[i])) ??
      undefined,
    [displayPayload, plotted, p.hiddenChannels],
  );

  // Fetch series whenever the active dataset, scale, channel roles, or
  // decimation eligibility change. P3.4: request server-side decimation
  // (`decimateWidth`) when the dataset is dense enough to matter AND nothing
  // downstream needs full-resolution row alignment — error bars/spans and
  // colour-mapped scatter read their arrays keyed by row position off the
  // FULL dataset, Scatter mode's density IS the signal, and any active
  // overlay/selection/grey-exclusion companion gets appended at full length
  // by composeDisplayPayload (see hasOverlayCompanions above). Everything
  // else (the common "just look at a big dataset" path) gets decimated.
  useEffect(() => {
    let cancelled = false;
    if (!active) {
      setPayload(null);
      basePayloadRef.current = null;
      decimateWidthRef.current = null;
      setBaseDecimated(false);
      return;
    }
    // Invalidate the cached base SYNCHRONOUSLY (before the async fetch below
    // settles) so the windowed-refetch effect never mistakes the PREVIOUS
    // base (a different dataset/channel-set/overlay state) for this one
    // during the gap — it sees `baseDecimated: false` and simply waits.
    basePayloadRef.current = null;
    setBaseDecimated(false);
    const eligible =
      active.data.time.length > DECIMATE_MIN_POINTS &&
      !hasOverlayCompanions({
        fitOverlay: p.fitOverlay,
        baselineOverlay: p.baselineOverlay,
        peakOverlay: p.peakOverlay,
        derivOverlay: p.derivOverlay,
        selection: p.selection,
        excludedDisplay: p.excludedDisplay,
        activeId: active.id,
        dropped,
      }) &&
      decimationRequestEligible({
        defaultTrace: p.defaultTrace,
        hasErrorBars: errorBars.size > 0,
        // G4 review round (P1 fix): a rich document is the errorSpans SOURCE
        // whenever `useDocumentErrors` is true (see that flag's own doc, and
        // the `errorSpans` useMemo below) -- `useDocumentErrors` already
        // implies `p.documentErrors` is non-empty, so this mirrors the
        // dataset branch's own "any roles at all disqualify decimation"
        // rule rather than trying to pre-filter to currently-plotted columns.
        hasErrorSpans: useDocumentErrors || !!active.errorRoles?.length,
        hasColorByColumns: colorByColumns.size > 0,
      });
    const decimateWidth = eligible ? defaultDecimateWidthHint() : null;
    fetchPlot(
      active.data,
      p.yScale === "log",
      p.xScale === "log",
      plotted,
      p.y2Keys,
      p.xKey,
      decimateWidth,
    ).then((raw) => {
      if (cancelled) return;
      // xCategories producer (gap #20 residual): a categorical-typed x
      // channel (nominal/ordinal — user override or inferred, see
      // lib/modeling.ts) gets ordinal x positions + resolved category labels
      // so lib/uplotOpts.ts's categoricalTickFormatter draws real tick names
      // instead of the raw channel numbers. No-op for a continuous x/time axis
      // (xKey === null, the time column, is never modeled/categorical).
      const xType = p.xKey == null ? "continuous" : channelModelingType(active, p.xKey);
      const composed = categoricalXPayload(raw, active.data, p.xKey, xType);
      basePayloadRef.current = composed;
      decimateWidthRef.current = decimateWidth;
      setPayload(composed);
      setBaseDecimated(!!composed.decimated);
    });
    return () => {
      cancelled = true;
    };
  }, [
    active,
    p.yScale,
    p.xScale,
    plotted,
    p.y2Keys,
    p.xKey,
    p.defaultTrace,
    errorBars,
    colorByColumns,
    dropped,
    p.fitOverlay,
    p.baselineOverlay,
    p.peakOverlay,
    p.derivOverlay,
    p.selection,
    p.excludedDisplay,
    useDocumentErrors,
  ]);

  // P3.4 zoom-refetch residual: when the BASE payload above came back
  // server-decimated, a committed zoom/pan re-fetches just the visible
  // x-window at the same width hint so it draws at full local detail instead
  // of the kept min/max envelope. Deliberately does NOT depend on
  // `payload`/`displayPayload` — only on the inputs needed to describe WHAT
  // to fetch (`p.xLim` + the same dataset/channel/scale identity the base
  // effect uses, plus `baseDecimated`). This effect's own `setPayload` call
  // must never be one of its own triggers, or every windowed fetch would
  // immediately re-arm itself (a fetch feedback loop).
  //
  // Latest-wins via AbortController: a newer commit (a further zoom, a pan,
  // or a reset to `xLim = null`) runs this effect's cleanup — which aborts
  // whatever windowed fetch was still in flight for the PREVIOUS commit —
  // before starting its own. Rapid successive zooms/pans therefore coalesce
  // onto whichever commit is current rather than queuing up. The `cancelled`
  // flag is a second, synchronous guard on top of the network-level abort
  // (belt & suspenders, the same idiom the base effect above already uses):
  // even in the unlikely event a response still resolves after this effect
  // instance was superseded, its `.then` is a no-op — so a slow response for
  // a window the user has since zoomed/panned/reset away from can never
  // clobber whatever IS currently committed.
  useEffect(() => {
    if (!p.xLim) {
      // Reset/autoscale: restore the cached full-range payload with no fetch
      // at all — it's already in memory from the base effect above.
      const base = basePayloadRef.current;
      if (base && base !== payload) setPayload(base);
      return;
    }
    if (!active || !shouldRefetchWindow(p.xLim, baseDecimated)) return;
    const [xMin, xMax] = p.xLim;
    let cancelled = false;
    const controller = new AbortController();
    fetchPlot(
      active.data,
      p.yScale === "log",
      p.xScale === "log",
      plotted,
      p.y2Keys,
      p.xKey,
      decimateWidthRef.current ?? defaultDecimateWidthHint(),
      xMin,
      xMax,
      controller.signal,
    )
      .then((raw) => {
        if (cancelled) return;
        const xType = p.xKey == null ? "continuous" : channelModelingType(active, p.xKey);
        setPayload(categoricalXPayload(raw, active.data, p.xKey, xType));
      })
      .catch(() => {
        // Aborted (superseded by a newer commit) or a genuine network error
        // while windowing — either way, leave whatever is currently
        // displayed as-is rather than clearing the plot.
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // `payload` is read but NOT listed — see this effect's header comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.xLim, active, plotted, p.y2Keys, p.xKey, p.yScale, p.xScale, baseDecimated]);

  // #36 / G4: built from Dataset.errorRoles (the canonical contract) by
  // default — absent for a dataset with no roles, in which case the legacy
  // symmetric bars stand. G4's figure-scoped error-honesty fix: the FOCUSED
  // window's OWN document errors (`p.documentErrors`) become the
  // authoritative source instead, IFF they contain at least one binding the
  // legacy `errKeys` projection cannot express (`hasRichErrorBindings`) —
  // an X-error or an asymmetric `+`/`-` half. A document whose errors are
  // entirely y/both is indistinguishable from what `errKeys` already
  // carries, so it takes this branch only when there is something genuinely
  // richer to show; every ORDINARY window's document derives its errors
  // FROM `errKeys` (`figureDocument.ts`'s `legacyErrorBindings`), so it can
  // never be rich and this can never flip an existing window's rendering.
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
  const errorSpans = useMemo(() => {
    if (!active) return new Map<number, ErrorSpan[]>();
    const bindings = useDocumentErrors ? p.documentErrors! : active.errorRoles;
    return bindings?.length ? buildErrorSpans(active.data, plotted, bindings) : new Map<number, ErrorSpan[]>();
  }, [active, plotted, useDocumentErrors, p.documentErrors]);

  return {
    payload,
    displayPayload,
    plotted,
    styleList,
    labelList,
    errorBars,
    errorSpans,
    colorByColumns,
    hidden,
  };
}
