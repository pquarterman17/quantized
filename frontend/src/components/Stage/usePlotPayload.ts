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

import { useEffect, useMemo, useState } from "react";

import { buildErrorColumns } from "../../lib/errorbars";
import { channelModelingType } from "../../lib/modeling";
import {
  categoricalXPayload,
  composeDisplayPayload,
  effectiveChannels,
  fetchPlot,
  type PlotPayload,
} from "../../lib/plotdata";
import { droppedRows } from "../../lib/rowstate";
import type { BaselineOverlay, Dataset, FitOverlay, PeakOverlay, SeriesStyle } from "../../lib/types";

export interface PlotPayloadParams {
  active: Dataset | null | undefined;
  yLog: boolean;
  xLog: boolean;
  xKey: number | null;
  yKeys: number[] | null;
  y2Keys: number[] | null;
  seriesOrder: number[] | null;
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  errKeys: Record<number, number>;
  hiddenChannels: number[];
  waterfall: number;
  excludedDisplay: "hide" | "grey";
  fitOverlay: FitOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  peakOverlay: PeakOverlay | null;
  derivOverlay: FitOverlay | null;
  selection: { datasetId: string; rows: number[] } | null;
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

  // Interactive-legend visibility, aligned 1:1 with the display series (overlays
  // — index ≥ plotted.length — are never hidden).
  const hidden = useMemo(
    () =>
      displayPayload?.series.map((_, i) => i < plotted.length && p.hiddenChannels.includes(plotted[i])) ??
      undefined,
    [displayPayload, plotted, p.hiddenChannels],
  );

  // Fetch series whenever the active dataset, scale, or channel roles change.
  useEffect(() => {
    let cancelled = false;
    if (!active) {
      setPayload(null);
      return;
    }
    fetchPlot(active.data, p.yLog, p.xLog, plotted, p.y2Keys, p.xKey).then((raw) => {
      if (cancelled) return;
      // xCategories producer (gap #20 residual): a categorical-typed x
      // channel (nominal/ordinal — user override or inferred, see
      // lib/modeling.ts) gets ordinal x positions + resolved category labels
      // so lib/uplotOpts.ts's categoricalTickFormatter draws real tick names
      // instead of the raw channel numbers. No-op for a continuous x/time axis
      // (xKey === null, the time column, is never modeled/categorical).
      const xType = p.xKey == null ? "continuous" : channelModelingType(active, p.xKey);
      setPayload(categoricalXPayload(raw, active.data, p.xKey, xType));
    });
    return () => {
      cancelled = true;
    };
  }, [active, p.yLog, p.xLog, plotted, p.y2Keys, p.xKey]);

  return { payload, displayPayload, plotted, styleList, labelList, errorBars, hidden };
}
