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

import { fixedLim } from "../../lib/axisLim";
import { groupLevelLabel, levelOrderFor } from "../../lib/categorical";
import { buildColorByColumns, type ColorScatterSpec } from "../../lib/colorscatter";
import { blocksDecimation, marks, useMarksVersion } from "../../lib/marksLoader";
import { hasOverlayCompanions } from "./overlayCompanions";
import { hasRichErrorBindings } from "../../lib/errorRoles";
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
  errorBindingsApplyToPlotted,
  shouldRefetchWindow,
} from "../../lib/plotDecimate";
import { applyGroupSplit, canvasGroupCol, groupSplitChannelMap } from "../../lib/plotGroupSplit";
import { applyLogOffsets } from "../../lib/logOffset";
import { legendUnitOnAxis } from "../../lib/legendUnitOnAxis";
import { useRowWindow } from "../../lib/rowWindowLoader";
import { droppedRows } from "../../lib/rowstate";
import { useStableByValue } from "../../lib/useStableValue";
import { useLogOffsetScaling, useOffsetErrorBars, useOffsetErrorSpans, useOffsetLabelList } from "./usePlotPayloadLogOffsets";
import { useEncodedLists, useStageEncoding } from "./usePlotEncoding";
import { useRowStateColumns } from "./useRowStateColumns";
import { waterfallXFetchWindow, withFullXSpan } from "../../lib/waterfallOffset";
import { useWaterfallX } from "./useWaterfallX";
import { usePerSeriesX } from "./usePerSeriesX";
import type { PlotPayloadParams, PlotPayloadResult } from "./usePlotPayloadTypes";
export type { PlotPayloadParams, PlotPayloadResult }; // their home moved to ./usePlotPayloadTypes


/** Fetch + compose the active dataset's plot payload and its per-channel
 *  style/label/error/hidden mappings. Re-fetches whenever the active dataset's
 *  data, a scale, or the plotted-channel selection changes (or decimation
 *  eligibility flips); re-composes (no re-fetch) whenever an overlay, the
 *  waterfall offset, the exclusion mode, or the row selection changes. */
export function usePlotPayload(p: PlotPayloadParams): PlotPayloadResult {
  const { active, xKey, selection, blockRows, overlays } = usePerSeriesX(p.active, p.xKey, p.selection, p); // gap-2 #2: own X; overlays in their bound block
  // ONE state, two fields, so `payloadDatasetId` is a property OF these rows.
  const [fetched, setFetched] = useState<{ payload: PlotPayload; datasetId: string } | null>(null);
  const payload = fetched?.payload ?? null;

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
  // misalignment `lib/plotDecimate.ts`'s own doc comment on error bars warns
  // about. Round 7 item 4: stabilized against its clone-on-every-sync source (see useStableValue.ts).
  const documentErrors = useStableByValue(p.documentErrors, (v) => JSON.stringify(v));
  const useDocumentErrors = hasRichErrorBindings(documentErrors);

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

  // What the base REQUEST is built from (perf audit 2026-09-29): a rename or
  // an exclusion toggle mints a new `active` over the SAME `data`, so every
  // fetch-side memo/effect keys on these fields, never on `active` itself.
  const data = active?.data;
  const activeId = active?.id;
  const roles = active?.channelRoles;
  // The plot's row window, when it fits the sheet (an unfit one is not applied; the chip says so). By value: a view read from a document is a fresh object.
  const { from: rowFrom, to: rowTo } = p.rowRange ?? {}; // by value: a view read from a document is a fresh object
  const rowRange = useMemo(() => (rowFrom === undefined ? undefined : { from: rowFrom, to: rowTo! }), [rowFrom, rowTo]);
  const rowWindow = useRowWindow(rowRange);

  // Rows dropped from the plot: manually excluded (#50) ∪ filter-failed (#53).
  // Stabilized by content so a rename doesn't recompose the O(rows) display.
  const dropped = useStableByValue(
    useMemo(() => droppedRows(active), [active]),
    (set) => [...set].join(","),
  );

  const groupCol = canvasGroupCol(p.groupKey, p.y2Keys); // P1.5: degrades to ungrouped + y2 (lib/plotGroupSplit)

  // Channels actually drawn (y selection minus the x-axis channel), in
  // order -- the REAL channels to fetch (a group split happens CLIENT-SIDE
  // below on the fetched columns, not via a separate per-level request).
  const fetchChannels = useMemo(
    () => (data ? effectiveChannels(data, p.yKeys, p.xKey, roles, p.seriesOrder) : []),
    [data, roles, p.yKeys, p.xKey, p.seriesOrder],
  );
  // P1.4: the window's Color / Symbol / Label encodings (usePlotEncoding.ts) --
  // when active they REPLACE the group split (the group joins the encoded one),
  // never offset or stagger, and drop errors / colour-mapping as it does.
  const encoded = useStageEncoding(active, p.encoding, groupCol, p.y2Keys, fetchChannels);
  const grouped = encoded ? encoded.split : groupCol !== null; // a factor splits the series
  // The group channel's own per-row codes (row-aligned to active.data) --
  // feeds both the channel-map expansion below and applyGroupSplit's call.
  const groupCodes = useMemo(
    () => (groupCol !== null && !encoded && data ? data.values.map((row) => row[groupCol]) : null),
    [data, groupCol, encoded],
  );
  // P1.5 edit-one/edit-all ruling (plotGroupSplit.ts header): the per-
  // DISPLAY-series channel map styleList/labelList/hidden (and PlotLegend/
  // PlotContextMenu's own `plotted[i]` lookups) key against.
  const plotted = useMemo(
    () => encoded?.plotted ?? (groupCodes ? groupSplitChannelMap(fetchChannels, groupCodes) : fetchChannels),
    [fetchChannels, groupCodes, encoded],
  );
  const waterfall = encoded ? 0 : p.waterfall;
  const waterfallDx = encoded || grouped || blockRows ? 0 : (p.waterfallDx ?? 0); // the X step: refused with a split, as on the wire

  const { offsetsApply, offsetsKey, scaledFitOverlay, scaledBaselineOverlay, scaledPeakOverlay, scaledDerivOverlay } =
    useLogOffsetScaling({ // P2.3 decade offsets -- see usePlotPayloadLogOffsets.ts
      plotted, hiddenChannels: p.hiddenChannels, seriesStyles: p.seriesStyles, waterfall, groupCol, encoded: !!encoded,
      ...overlays, // lib/overlayPlacement: each in its bound block on a per-series-X view, untouched otherwise
    });

  // Fold overlays + exclusion mask + selection brush in (see composeDisplayPayload).
  const displayPayload = useMemo(
    () =>
      payload && rowWindow
        ? rowWindow(legendUnitOnAxis(composeDisplayPayload(applyLogOffsets(payload, plotted, p.seriesStyles, offsetsApply), {
            id: activeId ?? null,
            waterfall,
            dropped,
            excludedDisplay: p.excludedDisplay,
            fitOverlay: scaledFitOverlay,
            baselineOverlay: scaledBaselineOverlay,
            peakOverlay: scaledPeakOverlay,
            derivOverlay: scaledDerivOverlay,
            selection,
          }), groupCol === null && !encoded ? p.active?.data : undefined), rowRange, data?.time.length ?? Infinity) // UX8-C: shared-unit legend; then the plot's row window (hidden rows draw and range nothing)
        : null,
    // `offsetsKey` stands in for `p.seriesStyles` (finding 8: this O(rows)
    // memo must not recompose on a colour/marker-only edit) -- see its doc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      payload, plotted, offsetsKey, offsetsApply, // P2.3 decade offsets (lib/logOffset.ts)
      scaledFitOverlay,
      scaledPeakOverlay,
      scaledBaselineOverlay,
      scaledDerivOverlay,
      waterfall,
      activeId,
      dropped,
      p.excludedDisplay,
      selection,
      rowRange, rowWindow,
    ],
  );

  // Map each display-series back to its dataset channel so the per-channel style
  // overrides land on the right line. Plotted channels come first (in yKeys order,
  // matching the backend), overlays after — those get `undefined` (defaults).
  const loaded = useMarksVersion();
  const encodedLists = useEncodedLists(encoded, displayPayload, p.seriesStyles, p.seriesLabels); // P1.4
  const styleList = useMemo(() => {
    if (!displayPayload) return undefined;
    const list = encodedLists?.styleList ?? displayPayload.series.map((_, i) => (i < plotted.length ? p.seriesStyles[plotted[i]] : undefined));
    // Plan item 24: per-point text symbols read their row's text (lazy). A group split or an encoding keeps every
    // row; a per-series-X view repeats the SHEET's rows per block, so its texts come from the sheet (`p.active`).
    return marks()?.withMarkerTexts(list, plotted, blockRows ? p.active : active, displayPayload.data) ?? list;
  }, [displayPayload, plotted, p.seriesStyles, loaded, blockRows, active, encodedLists]); // eslint-disable-line react-hooks/exhaustive-deps -- loaded: the chunk settling

  // Legend-rename overrides (finding 6 offset disclosure) and error-bar
  // magnitudes (finding 3 scaling), both aligned 1:1 to `plotted` -- see
  // usePlotPayloadLogOffsets.ts.
  const labelList = useOffsetLabelList(displayPayload, plotted, p.seriesLabels, p.seriesStyles, offsetsApply);
  const errorBars = useOffsetErrorBars(active, plotted, grouped, p.errKeys, p.seriesStyles, offsetsApply);

  // Colour-mapped-scatter specs per plotted series (MAIN #14), same p+1 keying (P1.4: an encoded gradient too); N5 size-by joins once `loaded`.
  const baseColorBy = useMemo(
    () => {
      if (encoded?.colorBy) return encoded.colorBy(encoded.styles(p.seriesStyles));
      if (!data || groupCol !== null || encoded) return new Map<number, ColorScatterSpec>();
      const base = buildColorByColumns(data, plotted, p.seriesStyles);
      return marks()?.withSizes(base, data, plotted, p.seriesStyles) ?? base;
    },
    [data, plotted, p.seriesStyles, groupCol, encoded, loaded], // eslint-disable-line react-hooks/exhaustive-deps -- loaded: the chunk settling
  );
  const colorByColumns = useRowStateColumns(baseColorBy, active, plotted, p.seriesStyles, groupCol !== null || !!encoded); // G24 (lazy)

  // Interactive-legend visibility, aligned 1:1 with the display series (overlays
  // — index ≥ plotted.length — are never hidden).
  const hidden = useMemo(
    () =>
      displayPayload?.series.map((_, i) => i < plotted.length && p.hiddenChannels.includes(plotted[i])) ??
      undefined,
    [displayPayload, plotted, p.hiddenChannels],
  );

  // Fetch series whenever the request's inputs change: the dataset's `data`,
  // the channels (roles folded in), the scales, the x channel's modeling type,
  // and decimation eligibility. P3.4: request server-side decimation
  // (`decimateWidth`) when the dataset is dense enough to matter AND nothing
  // downstream needs full-resolution row alignment — error bars/spans and
  // colour-mapped scatter read their arrays keyed by row position off the
  // FULL dataset, Scatter mode's density IS the signal, and any active
  // overlay/selection/grey-exclusion companion gets appended at full length
  // by composeDisplayPayload (see hasOverlayCompanions above). Everything
  // else (the common "just look at a big dataset" path) gets decimated.
  //
  // Perf audit 2026-09-29: eligibility is folded to ONE primitive boolean
  // here, OUTSIDE the effect, so display-only edits (a colour — `errorBars`/
  // `colorByColumns` are new Maps on every style edit — a selection, a
  // rename, an exclusion toggle) re-run the effect only when they actually
  // flip decimate-vs-full-res. Selection/exclusion never enter the request
  // body (composeDisplayPayload applies them client-side).
  const decimateEligible =
    !!active &&
    active.data.time.length > DECIMATE_MIN_POINTS &&
    !rowRange && // a bucketed set holds almost none of a short window's rows
    !hasOverlayCompanions({
      ...overlays, // the PLACED overlays: one that is not drawn does not block decimation
      selection,
      excludedDisplay: p.excludedDisplay,
      activeId: active.id,
      dropped,
    }) &&
    decimationRequestEligible({
      defaultTrace: p.defaultTrace,
      hasErrorBars: errorBars.size > 0,
      // M1: same bindings rule `errorSpans` below uses; this path draws X-error whiskers.
      hasErrorSpans: errorBindingsApplyToPlotted(useDocumentErrors ? documentErrors : active.errorRoles, plotted, { xErrorRenders: true }),
      hasColorByColumns: colorByColumns.size > 0 || blocksDecimation(Object.values(p.seriesStyles), active.data.time.length), // size-by: row-indexed
      hasGroupSplit: groupCol !== null || encoded !== null,
    });
  // xCategories producer (gap #20 residual): a categorical-typed x channel
  // (nominal/ordinal — user override or inferred, see lib/modeling.ts) gets
  // ordinal x positions + resolved category labels so lib/uplotOpts.ts's
  // categoricalTickFormatter draws real tick names instead of the raw channel
  // numbers. A primitive, so a `channelTypes` edit refetches only when it
  // changes THIS. No-op for a continuous x/time axis (xKey === null).
  const xType = active && xKey != null ? channelModelingType(active, xKey) : "continuous";

  useEffect(() => {
    let cancelled = false;
    if (!data || activeId === undefined) {
      setFetched(null);
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
    const decimateWidth = decimateEligible ? defaultDecimateWidthHint() : null;
    void fetchPlot(
      data,
      p.yScale === "log",
      p.xScale === "log",
      fetchChannels,
      p.y2Keys,
      xKey,
      decimateWidth,
    ).then((raw) => {
      if (cancelled) return;
      const cat = categoricalXPayload(raw, data, xKey, xType), withCategories = blockRows ? { ...cat, blockRows } : cat;
      // P1.5: group split (P1.4: or the encoded one) runs LAST, client-side, on the never-decimated fetch.
      const composed = encoded
        ? encoded.apply(withCategories)
        : groupCol !== null && groupCodes
          ? applyGroupSplit(
              withCategories,
              groupCodes,
              data.labels[groupCol] ?? `col ${groupCol}`,
              (code) => groupLevelLabel(data, groupCol, code),
              levelOrderFor(data, groupCol),
            )
          : withCategories;
      basePayloadRef.current = composed;
      decimateWidthRef.current = decimateWidth;
      setFetched({ payload: composed, datasetId: activeId });
      setBaseDecimated(!!composed.decimated);
    });
    return () => {
      cancelled = true;
    };
  }, [
    data,
    activeId,
    xType,
    p.yScale,
    p.xScale,
    fetchChannels,
    p.y2Keys,
    xKey, blockRows,
    decimateEligible,
    groupCol,
    groupCodes,
    encoded,
  ]);

  // P3.4 zoom-refetch residual: when the BASE payload above came back
  // server-decimated, a committed zoom/pan re-fetches just the visible
  // x-window at the same width hint so it draws at full local detail instead
  // of the kept min/max envelope. Deliberately does NOT depend on
  // `payload`/`displayPayload` — only on the inputs needed to describe WHAT
  // to fetch (`p.xLim` + the same dataset/channel/scale identity the base
  // effect uses, plus `baseDecimated`). This effect's own `setFetched` call
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
  const fetchLim = fixedLim(p.xLim); // same reference as p.xLim when fully fixed
  useEffect(() => {
    if (!fetchLim) {
      // Reset/autoscale: restore the cached full-range payload with no fetch
      // at all — it's already in memory from the base effect above.
      const base = basePayloadRef.current;
      // `activeId` is redundant here (the ref is cleared when there is none).
      if (base && base !== payload && activeId !== undefined) setFetched({ payload: base, datasetId: activeId });
      return;
    }
    if (!data || activeId === undefined || !shouldRefetchWindow(fetchLim, baseDecimated)) return;
    const base = basePayloadRef.current; // the full-range fetch; null only mid-invalidation
    // The zoom is in SHIFTED x, the route windows raw x: widen by the X stagger (identity without one).
    const [xMin, xMax] = base ? waterfallXFetchWindow(base, fetchLim, waterfallDx) : fetchLim;
    let cancelled = false;
    const controller = new AbortController();
    fetchPlot(
      data,
      p.yScale === "log",
      p.xScale === "log",
      fetchChannels,
      p.y2Keys,
      xKey,
      decimateWidthRef.current ?? defaultDecimateWidthHint(),
      xMin,
      xMax,
      controller.signal,
    )
      .then((raw) => {
        if (cancelled) return;
        const cat = categoricalXPayload(raw, data, xKey, xType), windowed = blockRows ? { ...cat, blockRows } : cat; // keeps the full-range X step basis:
        setFetched({ payload: base ? withFullXSpan(windowed, base) : windowed, datasetId: activeId });
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
  }, [fetchLim, data, activeId, xType, fetchChannels, p.y2Keys, xKey, p.yScale, p.xScale, baseDecimated, waterfallDx, blockRows]);

  // #36 / G4: the canonical-role error spans -- see usePlotPayloadLogOffsets.ts's
  // `useOffsetErrorSpans` for the document-vs-dataset authority rule.
  const errorSpans = useOffsetErrorSpans(
    active, plotted, grouped, useDocumentErrors ? documentErrors! : active?.errorRoles, p.seriesStyles, offsetsApply,
  );
  // Waterfall X step: LAST, over the composed payload + its row-aligned companions; refused with a split, as on the wire.
  const shown = useWaterfallX(displayPayload, payload, waterfallDx, { errorBars, errorSpans, colorByColumns });

  return {
    payload,
    payloadDatasetId: fetched?.datasetId ?? null,
    plotted,
    styleList,
    labelList: encodedLists?.labelList ?? labelList,
    legendLabels: encodedLists?.labelList,
    hidden,
    ...shown, // displayPayload + errorBars/errorSpans/colorByColumns, X-offset laid out when set
  };
}
