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
  /** Emphasized rendering (accent, filled larger markers) — the companion series
   *  highlighting rows in the current selection brush (#50 selection). */
  selected?: boolean;
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
  const channels = yChannels ?? defaultDenseChannels(ds, xKey);
  const y2 = new Set(y2Keys ?? []);
  const cols: (number | null)[][] = [x];
  for (const c of channels) {
    cols.push(ds.values.map((row) => (Number.isFinite(row[c]) ? row[c] : null)));
  }
  return {
    data: cols as uPlot.AlignedData,
    series: channels.map((c) => ({ label: ds.labels[c], unit: ds.units[c] ?? "", axis: y2.has(c) ? 1 : 0 })),
    // Prefer the Origin long name ("Theta") over the raw column letter ("A")
    // for the x-axis, matching what Origin shows; fall back to the letter.
    xLabel:
      xKey == null
        ? String(ds.metadata?.["x_column_long"] || ds.metadata?.["x_column_name"] || "x")
        : (ds.labels[xKey] ?? "x"),
    xUnit: xKey == null ? String(ds.metadata?.["x_column_unit"] ?? "") : (ds.units[xKey] ?? ""),
  };
}

/** How many rows have BOTH a finite x and a finite y — a channel's "usable
 *  density" against a given x source. A channel with few finite pairs can't
 *  render as a meaningful line, and worse: its stray finite values still enter
 *  uPlot's shared y-axis autoscale, squashing every other series into
 *  invisibility instead of just being invisible itself. */
function finitePairCount(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) count++;
  }
  return count;
}

/** A channel this much sparser than the densest candidate is excluded from
 *  the *default* (yKeys=null) view — see defaultDenseChannels. */
const MIN_DENSITY_RATIO = 0.1;

/** The channels an untouched dataset shows by default (yKeys=null): every
 *  non-x channel, EXCLUDING ones so NaN-sparse they can't be meaningfully
 *  co-plotted with the rest (fewer than 2 finite x/y pairs, or less than 10%
 *  as dense as the densest candidate channel). Instrument files that pack many
 *  measurement types into one wide table (e.g. Quantum Design magnetometry:
 *  AC-susceptibility columns are NaN outside AC scans, DC columns NaN outside
 *  DC scans, …) are the motivating case, but the heuristic is generic — not
 *  QD-specific — so it helps any parser whose "all columns" output is
 *  column-sparse. Falls back to "every candidate" when all are equally sparse
 *  (nothing to gain by hiding any of them) or none are dense at all, so the
 *  plot is never emptied outright. The single source of truth for "what does
 *  a freshly-loaded dataset show" — shared by the main plot (effectiveChannels)
 *  and the Library thumbnail (Sparkline). */
export function defaultDenseChannels(ds: DataStruct, xKey: number | null = null): number[] {
  // A parser-provided default plotted set (metadata.default_value_channels —
  // e.g. reflectometry .dat picks R + fit, leaving dQ/fresnel off by default)
  // wins over the density heuristic when present and valid.
  const hint = (ds.metadata ?? {})["default_value_channels"];
  if (Array.isArray(hint)) {
    const picks = hint.filter(
      (v): v is number =>
        typeof v === "number" && Number.isInteger(v) && v >= 0 && v < ds.labels.length && v !== xKey,
    );
    if (picks.length > 0) return picks;
  }
  const xs = xKey == null ? ds.time : ds.values.map((row) => row[xKey]);
  const candidates = ds.labels.map((_, i) => i).filter((i) => i !== xKey);
  const counts = candidates.map((c) =>
    finitePairCount(
      xs,
      ds.values.map((row) => row[c]),
    ),
  );
  const maxCount = counts.length ? Math.max(...counts) : 0;
  if (maxCount === 0) return candidates; // nothing plots anyway — don't hide any
  const floor = Math.max(2, maxCount * MIN_DENSITY_RATIO);
  const dense = candidates.filter((_, i) => counts[i] >= floor);
  return dense.length > 0 ? dense : candidates;
}

/** The single channel a one-line preview (the Library thumbnail) should draw:
 *  the first channel in the plot's own default dense set (see
 *  defaultDenseChannels), NOT a hardcoded "channel 0". Keeps the thumbnail
 *  showing the same real data the main plot draws by default even when
 *  channel 0 itself happens to be the NaN-sparse one. Returns null for a
 *  dataset with no channels at all. */
export function primaryChannel(ds: DataStruct): number | null {
  const dense = defaultDenseChannels(ds, null);
  return dense.length > 0 ? dense[0] : null;
}

/** The value-channel indices actually plotted, in order: the y selection (or the
 *  robust dense default — see defaultDenseChannels), minus the channel used as
 *  the x-axis (you can't plot a channel against itself), minus any channel
 *  carrying a non-data column role (label/ignore — those are not curves). The
 *  single source of truth shared by the fetch + the per-channel style mapping
 *  in every stage. */
export function effectiveChannels(
  ds: DataStruct,
  yKeys: number[] | null,
  xKey: number | null,
  roles?: Record<number, ChannelRole>,
  order?: number[] | null,
): number[] {
  const base = yKeys ?? defaultDenseChannels(ds, xKey);
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

/** Original row indices whose plotted x falls within [x0, x1] (endpoints in any
 *  order). Non-finite / null x are skipped. The plot-brush maps a dragged x-band
 *  to selected rows through this — independent of draw order, so the returned
 *  indices line up with worksheet rows and index-aligned overlays (#50). */
export function rowsInXRange(xs: (number | null)[], x0: number, x1: number): number[] {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  const rows: number[] = [];
  for (let r = 0; r < xs.length; r++) {
    const v = xs[r];
    if (v != null && Number.isFinite(v) && v >= lo && v <= hi) rows.push(r);
  }
  return rows;
}

/** Append an accent-highlighted points-companion per series for the selected
 *  rows (value where selected, null elsewhere) so the plot echoes the worksheet
 *  selection. Runs last (on the already-masked/overlaid payload), so a selected
 *  row that is also hidden stays hidden. No-op when nothing is selected. */
export function highlightSelectedPayload(payload: PlotPayload, selected: Set<number>): PlotPayload {
  if (selected.size === 0) return payload;
  const [x, ...ys] = payload.data as (number | null)[][];
  const marks = ys.map((col) => col.map((v, r) => (selected.has(r) ? v : null)));
  return {
    ...payload,
    data: [x, ...ys, ...marks] as uPlot.AlignedData,
    series: [
      ...payload.series,
      ...payload.series.map((s) => ({
        ...s,
        label: `${s.label} (selected)`,
        kind: "points" as const,
        selected: true,
      })),
    ],
  };
}

/** Clamp a dragged x-range to the plotted x-extent and return it low→high, or
 *  null for a degenerate (zero-width / out-of-range) drag. Shared by the region
 *  and select tools so both bound the band to the data the same way. */
export function clampPlottedRange(
  xs: (number | null)[],
  x0: number,
  x1: number,
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of xs) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return null; // no finite x
  const lo = Math.max(min, Math.min(x0, x1));
  const hi = Math.min(max, Math.max(x0, x1));
  return hi > lo ? [lo, hi] : null;
}

/** Everything the plot needs to fold into the drawn payload, beyond the base. */
export interface DisplayCompose {
  id: string | null;
  waterfall: number;
  dropped: Set<number>;
  excludedDisplay: "hide" | "grey";
  fitOverlay: FitOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  peakOverlay: PeakOverlay | null;
  /** ROI gadget family (#34) differentiate mode's dy/dx curve. Same
   *  `{datasetId,y}` shape as fitOverlay (drawn on the secondary axis so its
   *  usually-very-different scale never squashes the primary data). */
  derivOverlay: FitOverlay | null;
  selection: { datasetId: string; rows: number[] } | null;
}

/** Compose the drawn payload in the canonical layer order: waterfall offset →
 *  exclusion mask (#50/#53) → fit / baseline / peak / deriv overlays →
 *  selection brush (#50). The x-length is preserved throughout so every
 *  overlay stays index-aligned with the base series. */
export function composeDisplayPayload(payload: PlotPayload, o: DisplayCompose): PlotPayload {
  const base = applyWaterfall(payload, o.waterfall);
  const masked = maskExcludedPayload(base, o.dropped, o.excludedDisplay);
  const withFit = withFitOverlay(masked, o.fitOverlay, o.id);
  const withBase = withBaselineOverlay(withFit, o.baselineOverlay, o.id);
  const withPeaks = withPeakOverlay(withBase, o.peakOverlay, o.id);
  const withDeriv = withDerivOverlay(withPeaks, o.derivOverlay, o.id);
  const sel =
    o.selection && o.id && o.selection.datasetId === o.id ? new Set(o.selection.rows) : null;
  return sel ? highlightSelectedPayload(withDeriv, sel) : withDeriv;
}

/** Align an overlay y-column to the plotted payload length. The payload may have
 *  been shortened by dropTrailingEmptyRows (which only trims the TAIL), while a
 *  fit/baseline/peak overlay is built at the dataset's full row count — so a
 *  longer overlay is a prefix of the plotted rows and is truncated to align.
 *  Returns null only when the overlay is strictly SHORTER than the plotted x (a
 *  genuine mismatch that can't be aligned). Without this, an overlay on any
 *  dataset with trailing empty rows (e.g. a sparse Hc2 worksheet) silently
 *  vanishes because its full length != the trimmed payload length. */
function alignOverlayY(y: (number | null)[], target: number): (number | null)[] | null {
  if (y.length === target) return y;
  if (y.length > target) return y.slice(0, target);
  return null;
}

/** Append a fit curve as an extra series, but only when the overlay belongs to
 *  the active dataset and can align to the plotted x. Otherwise return the
 *  payload unchanged — a genuinely mismatched fit silently drops out. */
export function withFitOverlay(
  payload: PlotPayload,
  overlay: FitOverlay | null,
  activeId: string | null,
): PlotPayload {
  if (!overlay || overlay.datasetId !== activeId) return payload;
  const y = alignOverlayY(overlay.y, payload.data[0].length);
  if (y === null) return payload;
  return {
    ...payload,
    data: [...payload.data, y] as uPlot.AlignedData,
    series: [...payload.series, { label: "fit", unit: "" }],
  };
}

/** Append the differentiate gadget's dy/dx curve (#34), same guards as
 *  withFitOverlay. Drawn on the secondary (right) Y axis — a derivative's
 *  scale is usually wildly different from the plotted data's, and sharing the
 *  primary axis would squash one or the other. */
export function withDerivOverlay(
  payload: PlotPayload,
  overlay: FitOverlay | null,
  activeId: string | null,
): PlotPayload {
  if (!overlay || overlay.datasetId !== activeId) return payload;
  const y = alignOverlayY(overlay.y, payload.data[0].length);
  if (y === null) return payload;
  return {
    ...payload,
    data: [...payload.data, y] as uPlot.AlignedData,
    series: [...payload.series, { label: "dy/dx", unit: "", axis: 1 }],
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
  const y = alignOverlayY(overlay.y, payload.data[0].length);
  if (y === null) return payload;
  return {
    ...payload,
    data: [...payload.data, y] as uPlot.AlignedData,
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
  const y = alignOverlayY(overlay.y, payload.data[0].length);
  if (y === null) return payload;
  return {
    ...payload,
    data: [...payload.data, y] as uPlot.AlignedData,
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
/**
 * Trim trailing rows that yield NO plottable point from the END of the payload.
 * A row is unplottable when its x is null/non-finite, OR (when there are y series)
 * every y at that row is null/non-finite. Imported worksheets — Origin especially
 * — carry "allocated but unfilled" trailing rows in two shapes: sometimes as
 * trailing null x (the nrows-counts-allocated artifact), and sometimes as a
 * formula-filled x column (e.g. 0..10 across every allocated row) whose measured
 * y columns stop after the first handful of points. uPlot optimizes x-axis
 * autoscale by reading the LAST array element as the max (it assumes x is sorted
 * ascending), so either tail stretches the x-range far past the real data and
 * collapses the actual points against the left edge on first view (the near-
 * vertical-line symptom). A row with no drawable point is safe to drop; interior
 * gaps are left in place (uPlot draws them as gaps) so plot-brush row indices stay
 * aligned with the source rows.
 */
export function dropTrailingEmptyRows(payload: PlotPayload): PlotPayload {
  const cols = payload.data as (number | null)[][];
  const x = cols[0];
  const hasY = cols.length > 1;
  const finite = (v: number | null | undefined): boolean => v != null && Number.isFinite(v);
  const plottable = (i: number): boolean => {
    if (!finite(x[i])) return false; // no x → no point
    if (!hasY) return true; // x-only payload: x alone decides
    for (let c = 1; c < cols.length; c++) if (finite(cols[c][i])) return true;
    return false; // x present but every y empty → nothing to draw at this row
  };
  let end = x.length;
  while (end > 0 && !plottable(end - 1)) end--;
  if (end === x.length) return payload; // no trailing empty tail — fast path
  const data = cols.map((col) => col.slice(0, end));
  return { ...payload, data: data as uPlot.AlignedData };
}

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
    return dropTrailingEmptyRows(fromResponse(r));
  } catch {
    return dropTrailingEmptyRows(buildColumns(ds, y2Keys, xKey, yKeys));
  }
}
