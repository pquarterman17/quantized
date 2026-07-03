// Bridge a DataStruct to uPlot AlignedData. Primary path hits the backend
// /api/plot/series route; a pure client-side builder is the offline fallback
// (and what the unit tests exercise).

import type uPlot from "uplot";

import { plotSeries } from "./api";
import type {
  BaselineOverlay,
  ChannelRole,
  DataStruct,
  FitOverlay,
  PeakOverlay,
  PlotSeriesResponse,
} from "./types";

export interface PlotSeriesSpec {
  label: string;
  unit: string;
  /** "points" renders markers only (peak overlay); default is a line. */
  kind?: "line" | "points";
  /** 0 = primary (left) Y axis, 1 = secondary (right) — the dual-Y feature. */
  axis?: number;
  /** De-emphasized rendering (faint stroke, hollow markers) — the "grey" mode
   *  companion series showing excluded/filtered points (#50/#53). */
  muted?: boolean;
}

export interface PlotPayload {
  data: uPlot.AlignedData;
  series: PlotSeriesSpec[];
  xLabel: string;
  xUnit: string;
}

/** Pure client-side column packing — the offline mirror of /api/plot/series.
 *  `xKey` (a value-channel index, null = ds.time) chooses the x-axis source;
 *  `yChannels` is the explicit list of channels to plot (null = all channels
 *  except the x one). `y2Keys` (channel indices) tags those series with axis 1
 *  for the offline dual-Y path. */
export function buildColumns(
  ds: DataStruct,
  y2Keys: number[] | null = null,
  xKey: number | null = null,
  yChannels: number[] | null = null,
): PlotPayload {
  const xSrc = xKey == null ? ds.time : ds.values.map((row) => row[xKey]);
  const x = xSrc.map((v) => (Number.isFinite(v) ? v : null));
  const channels = yChannels ?? ds.labels.map((_, i) => i).filter((i) => i !== xKey);
  const y2 = new Set(y2Keys ?? []);
  const cols: (number | null)[][] = [x];
  for (const c of channels) {
    cols.push(ds.values.map((row) => (Number.isFinite(row[c]) ? row[c] : null)));
  }
  return {
    data: cols as uPlot.AlignedData,
    series: channels.map((c) => ({ label: ds.labels[c], unit: ds.units[c] ?? "", axis: y2.has(c) ? 1 : 0 })),
    xLabel: xKey == null ? String(ds.metadata?.["x_column_name"] ?? "x") : (ds.labels[xKey] ?? "x"),
    xUnit: xKey == null ? String(ds.metadata?.["x_column_unit"] ?? "") : (ds.units[xKey] ?? ""),
  };
}

/** The value-channel indices actually plotted, in order: the y selection (or all
 *  channels), minus the channel used as the x-axis (you can't plot a channel
 *  against itself), minus any channel carrying a non-data column role
 *  (label/ignore — those are not curves). The single source of truth shared by
 *  the fetch + the per-channel style mapping in every stage. */
export function effectiveChannels(
  ds: DataStruct,
  yKeys: number[] | null,
  xKey: number | null,
  roles?: Record<number, ChannelRole>,
  order?: number[] | null,
): number[] {
  const base = yKeys ?? ds.labels.map((_, i) => i);
  const filtered = base.filter((c) => c !== xKey && !roles?.[c]);
  if (!order || order.length === 0) return filtered;
  // Reorder by the user's draw order; channels absent from `order` keep their
  // natural position after the ordered ones (stable sort on the order index).
  const rank = (c: number) => {
    const i = order.indexOf(c);
    return i === -1 ? order.length + filtered.indexOf(c) : i;
  };
  return [...filtered].sort((a, b) => rank(a) - rank(b));
}

function fromResponse(r: PlotSeriesResponse): PlotPayload {
  return {
    data: r.data as uPlot.AlignedData,
    series: r.series.map((s) => ({ label: s.label, unit: s.unit, axis: s.axis ?? 0 })),
    xLabel: r.x.label,
    xUnit: r.x.unit,
  };
}

/** Honor row exclusion (#50) + the local filter (#53) on the plot without
 *  changing the x length (so overlays/error-bars/waterfall stay aligned): null
 *  the `dropped` rows out of every data series so they aren't drawn. In "grey"
 *  mode also append a muted points-companion per series so the dropped points
 *  stay visible but de-emphasized. Identity when nothing is dropped. Applied to
 *  the raw fetched payload, BEFORE overlays are spliced on. */
export function maskExcludedPayload(
  payload: PlotPayload,
  dropped: Set<number>,
  mode: "hide" | "grey",
): PlotPayload {
  if (dropped.size === 0) return payload;
  const [x, ...ys] = payload.data as (number | null)[][];
  const keptOnly = ys.map((col) => col.map((v, r) => (dropped.has(r) ? null : v)));
  if (mode === "hide") {
    return { ...payload, data: [x, ...keptOnly] as uPlot.AlignedData };
  }
  const ghosts = ys.map((col) => col.map((v, r) => (dropped.has(r) ? v : null)));
  return {
    ...payload,
    data: [x, ...keptOnly, ...ghosts] as uPlot.AlignedData,
    series: [
      ...payload.series,
      ...payload.series.map((s) => ({
        ...s,
        label: `${s.label} (excluded)`,
        kind: "points" as const,
        muted: true,
      })),
    ],
  };
}

/** Append a fit curve as an extra series, but only when the overlay belongs to
 *  the active dataset and aligns to the plotted x (same point count). Otherwise
 *  return the payload unchanged — a stale/mismatched fit silently drops out. */
export function withFitOverlay(
  payload: PlotPayload,
  overlay: FitOverlay | null,
  activeId: string | null,
): PlotPayload {
  if (!overlay || overlay.datasetId !== activeId) return payload;
  if (overlay.y.length !== payload.data[0].length) return payload;
  return {
    ...payload,
    data: [...payload.data, overlay.y] as uPlot.AlignedData,
    series: [...payload.series, { label: "fit", unit: "" }],
  };
}

/** Build a sparse y-column (null everywhere except the data point nearest each
 *  peak center, set to its height) so peaks render as markers on the shared x. */
export function peakOverlayArray(
  time: number[],
  peaks: { center: number; height: number }[],
): (number | null)[] {
  const y: (number | null)[] = new Array(time.length).fill(null);
  for (const p of peaks) {
    if (!Number.isFinite(p.center)) continue;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < time.length; i++) {
      const d = Math.abs(time[i] - p.center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    y[best] = p.height;
  }
  return y;
}

/** Append an estimated baseline as an extra line series (same guards as
 *  withFitOverlay: must belong to the active dataset and align to the x). */
export function withBaselineOverlay(
  payload: PlotPayload,
  overlay: BaselineOverlay | null,
  activeId: string | null,
): PlotPayload {
  if (!overlay || overlay.datasetId !== activeId) return payload;
  if (overlay.y.length !== payload.data[0].length) return payload;
  return {
    ...payload,
    data: [...payload.data, overlay.y] as uPlot.AlignedData,
    series: [...payload.series, { label: "baseline", unit: "" }],
  };
}

/** Append peak markers as a points-only series (same guards as withFitOverlay). */
export function withPeakOverlay(
  payload: PlotPayload,
  overlay: PeakOverlay | null,
  activeId: string | null,
): PlotPayload {
  if (!overlay || overlay.datasetId !== activeId) return payload;
  if (overlay.y.length !== payload.data[0].length) return payload;
  return {
    ...payload,
    data: [...payload.data, overlay.y] as uPlot.AlignedData,
    series: [...payload.series, { label: "peaks", unit: "", kind: "points" }],
  };
}

/** Vertically offset each series for a waterfall view: series s (1-indexed among
 *  the value columns) is shifted up by (s-1)·fraction·span, where span is the
 *  combined y-range. `fraction` is 0..1 (0 = off); a no-op with <2 series. The
 *  offset is display-only, so absolute y-values no longer read true (standard for
 *  waterfall). Apply to the base payload before overlays so channel 0 stays put. */
export function applyWaterfall(payload: PlotPayload, fraction: number): PlotPayload {
  if (fraction <= 0 || payload.data.length <= 2) return payload;
  let lo = Infinity;
  let hi = -Infinity;
  for (let s = 1; s < payload.data.length; s++) {
    for (const v of payload.data[s]) {
      if (v != null && Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  const span = hi > lo ? hi - lo : 1;
  const step = fraction * span;
  const cols = payload.data as unknown as (number | null)[][];
  const data = cols.map((col, s) =>
    s === 0 ? col : col.map((v) => (v == null ? v : v + (s - 1) * step)),
  );
  return { ...payload, data: data as unknown as uPlot.AlignedData };
}

/** Fetch plot series from the backend; fall back to client packing offline.
 *  `xKey` selects a value channel as the x-axis (null = ds.time); `yKeys` is the
 *  effective plotted-channel list (already excluding the x channel). */
export async function fetchPlot(
  ds: DataStruct,
  yLog: boolean,
  xLog = false,
  yKeys: number[] | null = null,
  y2Keys: number[] | null = null,
  xKey: number | null = null,
): Promise<PlotPayload> {
  try {
    const r = await plotSeries({
      dataset: ds,
      y_log: yLog,
      x_log: xLog,
      x_key: xKey ?? undefined,
      y_keys: yKeys ?? undefined,
      y2_keys: y2Keys ?? undefined,
    });
    return fromResponse(r);
  } catch {
    return buildColumns(ds, y2Keys, xKey, yKeys);
  }
}
