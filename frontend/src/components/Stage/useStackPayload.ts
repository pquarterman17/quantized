// The plain per-channel STACK leg's data for `useMultiPanelStage`: the channels it draws, the server payload
// fetched for them (with the channels it was fetched FOR), and the per-panel styles, error bars and legend renames
// derived from that snapshot. Extracted from the hook (at its module-size pin) with its code unchanged. Idle
// (null payload) whenever a spatial, facet or break arrangement is active.

import { useEffect, useMemo, useState } from "react";

import { buildErrorColumns } from "../../lib/stackErrorSpans";
import { fetchPlot, type PlotPayload } from "../../lib/plotdata";
import { perSeriesXData } from "../../lib/perSeriesX";
import { shownCurves } from "../../lib/shownCurves";
import {
  DECIMATE_MIN_POINTS,
  decimationRequestEligible,
  defaultDecimateWidthHint, errorBindingsApplyToPlotted,
} from "../../lib/plotDecimate";
import type { AxisScale, Dataset, DefaultTrace, SeriesStyle } from "../../lib/types";

export interface StackPayloadParams {
  active: Dataset | null | undefined;
  spatial: boolean;
  facet: boolean;
  breakMode: boolean;
  yKeys: number[] | null;
  xKey: number | null;
  y2Keys: number[] | null;
  seriesOrder: number[] | null;
  hiddenChannels: readonly number[];
  yScale: AxisScale;
  xScale: AxisScale;
  defaultTrace?: DefaultTrace;
  errKeys: Record<number, number>;
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  ensureBookData: (id: string) => void;
}

export function useStackPayload(params: StackPayloadParams) {
  const {
    active, spatial, facet, breakMode, yKeys, xKey, y2Keys, seriesOrder, hiddenChannels, yScale, xScale,
    defaultTrace, errKeys, seriesStyles, seriesLabels, ensureBookData,
  } = params;
  // The fetched stack payload TOGETHER with the channels it was fetched for
  // (BUG-014 round 5, N4): `plotted` recomputes synchronously with the view
  // while `fetchPlot` resolves later, so per-panel labels/styles/error bars
  // derived from `plotted` briefly dressed the OLD payload's panels in the
  // NEW list (measured: 3 panels wearing a 2-entry label list). Derived from
  // this snapshot instead, the two cannot disagree.
  const [payload, setPayload] = useState<{ payload: PlotPayload; channels: number[] } | null>(null);

  // Channels actually drawn (y selection minus the x-axis channel), in order (plain stack only).
  const plotted = useMemo(
    () =>
      !spatial && !facet && !breakMode && active
        ? shownCurves(active.data, { yKeys, xKey, seriesOrder, hiddenChannels }, active.channelRoles)
        : [],
    [spatial, facet, breakMode, active, yKeys, xKey, seriesOrder, hiddenChannels],
  );
  const styleList = useMemo(() => (payload?.channels ?? []).map((ch) => seriesStyles[ch]), [payload, seriesStyles]);
  // One error-bar map per stacked panel (each panel is a single-series uPlot
  // instance, so its own column index is always 1 — see `buildErrorColumns`'s
  // 1-based keying). Mirrors `usePlotPayload.errorBars`, scoped per panel.
  const errorBarsList = useMemo(
    () => (active ? (payload?.channels ?? []).map((ch) => buildErrorColumns(perSeriesXData(active, xKey, payload?.channels)?.data ?? active.data, [ch], errKeys)) : []),
    [active, payload, errKeys, xKey],
  );
  // BUG-014 round 4: the channel-keyed renames the facet leg already
  // projects (`facetGridRender`), projected for the two OTHER legs.
  // STACK: one entry per FETCHED channel in panel order — `splitPayload`
  // makes exactly one single-series panel per series of that payload, so the
  // same indexing `styleList` uses is correct here.
  const labelList = useMemo(() => (payload?.channels ?? []).map((ch) => seriesLabels[ch]), [payload, seriesLabels]);

  useEffect(() => {
    let cancelled = false;
    if (spatial || facet || breakMode || !active) {
      setPayload(null);
      return;
    }
    // ORIGIN_FILE_DECODE_PLAN #38: the active dataset may still be a lazy
    // Origin book — trigger its full-data fetch; the payload below renders
    // from whatever `active.data` currently is (preview now, full once the
    // fetch lands and this effect re-runs off the `active` dependency).
    if (active.pending) ensureBookData(active.id);
    // P3.4: same server-side decimation hint usePlotPayload.ts requests for
    // the single-plot path — multi-panel never composes an overlay onto
    // `payload` (no composeDisplayPayload call in this file), so only the
    // error-bar/scatter guards apply, not the overlay-companion one.
    const decimateWidth =
      active.data.time.length > DECIMATE_MIN_POINTS &&
      decimationRequestEligible({
        defaultTrace,
        hasErrorBars: Object.keys(errKeys).length > 0,
        hasErrorSpans: errorBindingsApplyToPlotted(active.errorRoles, plotted, { xErrorRenders: true }), // M1: the stack draws X whiskers too
        hasColorByColumns: false,
      })
        ? defaultDecimateWidthHint()
        : null;
    const v = perSeriesXData(active, xKey, plotted); /* gap-2 #2: each Y on its own X */ void fetchPlot(v?.data ?? active.data, yScale === "log", xScale === "log", plotted, y2Keys, v ? null : xKey, decimateWidth).then(
      (p) => {
        if (!cancelled) setPayload({ payload: p, channels: plotted });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [spatial, facet, breakMode, active, yScale, xScale, plotted, y2Keys, xKey, defaultTrace, errKeys]); // eslint-disable-line react-hooks/exhaustive-deps -- `ensureBookData` deliberately excluded: stable store-action reference, see its param doc above (R9).
  return { payload, plotted, styleList, errorBarsList, labelList };
}
