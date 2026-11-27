// The curve-measurement ROI gadget kinds (plan item 2): intersect, interpolate
// and rise time. Pure helpers for the lazy compute body (store/gadgetRun.ts);
// the numbers come from the curve-measure calc (`/api/curve-measure`, the same
// calls the "Curve measurements" panel makes) and, for interpolate, the
// worksheet formula language's `interp()` (lib/formulaMath, numpy.interp), so
// no measurement math lives here. Loaded only with the gadget compute chunk.

import type { IntersectResult, LevelCrossingResult, StepTimeResult } from "./api/curveMeasure";
import { xUnitOf } from "./errorRoles";
import { interpAt, interpTable } from "./formulaMath";
import { ownXKey } from "./perSeriesX";
import { effectiveChannels } from "./plotdata";
import { gadgetCurve, selectRoiRows } from "./quickfit";
import type { Dataset, OverlayBinding } from "./types";

export { GADGET_STEP_BODY } from "./gadgetMeasureOptions";

/** Units of what a measurement reports: curve A's X and Y, and curve B's Y. */
export interface MeasureUnits {
  x: string;
  y: string;
  yB: string;
}

/** What a measurement was computed on, kept for Commit and Report: the worksheet
 *  and its fingerprint, the region, both curves, and the SOURCE rows (worksheet
 *  rows, 1-based as shown) the region held. */
export interface MeasureSource {
  id: string;
  computedOn: string;
  roi: [number, number];
  a: OverlayBinding;
  b: OverlayBinding | null;
  /** The worksheet curve B was read from (null = the active one). */
  bSheet: string | null;
  rows: { first: number; last: number; n: number } | null;
}

interface Stamp {
  units: MeasureUnits;
  source: MeasureSource;
}

/** What the chip shows for the curve-measurement modes. */
export type GadgetMeasure =
  | ({ mode: "intersect"; r: IntersectResult; bKey: number } & Stamp)
  | ({ mode: "levelcrossing"; r: LevelCrossingResult; auto: boolean } & Stamp)
  | ({ mode: "risetime"; r: StepTimeResult } & Stamp)
  | { mode: "interpolate"; at: [number, number]; rows: { yKey: number; y: [number | null, number | null] }[] };

type View = Parameters<typeof gadgetCurve>[1];

/** Unit of a column pick (null X = the time axis, whose unit is in the metadata). */
export function unitOfColumn(ds: Dataset, xKey: number | null | undefined, yKey?: number): string {
  if (yKey !== undefined) return ds.data.units[yKey] ?? "";
  return xKey == null ? xUnitOf(ds.data.metadata) : (ds.data.units[xKey] ?? "");
}

/** The first and last SOURCE row (1-based, as the worksheet shows them) of a selection. */
export function sourceRowSpan(rows: readonly number[]): MeasureSource["rows"] {
  if (rows.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  return { first: lo + 1, last: hi + 1, n: rows.length };
}

/** What to draw on the plot for a measurement: a ring at every point and a
 *  horizontal guide at every level. Data coordinates; the plot's own Y scale. */
export function measureMarkers(m: GadgetMeasure | null): { points: { x: number; y: number }[]; levels: number[] } {
  if (!m) return { points: [], levels: [] };
  if (m.mode === "intersect") return { points: m.r.intersections.map((p) => ({ x: p.x, y: p.y })), levels: [] };
  if (m.mode === "levelcrossing") return { points: m.r.crossings.map((c) => ({ x: c.x, y: m.r.level })), levels: [m.r.level] };
  if (m.mode === "risetime") {
    return {
      points: [{ x: m.r.x_low, y: m.r.low_level }, { x: m.r.x_high, y: m.r.high_level }],
      levels: [m.r.low_level, m.r.high_level],
    };
  }
  const points: { x: number; y: number }[] = [];
  for (const row of m.rows) row.y.forEach((v, i) => { if (v !== null) points.push({ x: m.at[i]!, y: v }); });
  return { points, levels: [] };
}

/** Curve B for an intersection: the picked channel when it is a real channel other
 *  than curve A, else the next visible plotted curve. Each is on its OWN X. */
export function curveBFor(ds: Dataset, view: View, a: OverlayBinding, pick: number | null, other: Dataset | null = null): OverlayBinding | null {
  if (other) {
    // Another worksheet: its time axis against the picked channel (the panel's default pick: the second column).
    const n = other.data.labels.length;
    const yKey = pick !== null && pick >= 0 && pick < n ? pick : Math.min(1, n - 1);
    return n === 0 ? null : { yKey, xKey: null };
  }
  const own = (yKey: number): OverlayBinding => ({ yKey, xKey: ownXKey(ds, view.xKey, yKey) });
  if (pick !== null && pick !== a.yKey && pick >= 0 && pick < ds.data.labels.length) return own(pick);
  const plotted = effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder);
  const next = plotted.find((c) => c !== a.yKey && !view.hiddenChannels.includes(c));
  return next === undefined ? null : own(next);
}

/** The curve as drawn (X ascending, repeated X averaged, like the calc's own
 *  preparation), as an `interp()` table; null with fewer than two distinct X. */
function curveTable(x: readonly number[], y: readonly number[]) {
  const order = x.map((_, i) => i).sort((p, q) => x[p]! - x[q]!);
  const xs: number[] = [];
  const ys: number[] = [];
  let run = 0;
  for (const i of order) {
    if (xs.length > 0 && xs[xs.length - 1] === x[i]) {
      ys[ys.length - 1] = ys[ys.length - 1]! + (y[i]! - ys[ys.length - 1]!) / ++run;
    } else {
      xs.push(x[i]!);
      ys.push(y[i]!);
      run = 1;
    }
  }
  return xs.length < 2 ? null : interpTable(xs, ys, "X");
}

/** The interpolated Y of every visible plotted curve at each cursor X (null
 *  outside the curve's X range, where nothing is drawn). */
export function interpolateRows(ds: Dataset, view: View, at: readonly [number, number]): Extract<GadgetMeasure, { mode: "interpolate" }>["rows"] {
  const plotted = effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder);
  return plotted
    .filter((c) => !view.hiddenChannels.includes(c))
    .map((yKey) => {
      const sel = selectRoiRows(ds, [-Infinity, Infinity], yKey, ownXKey(ds, view.xKey, yKey));
      const t = curveTable(sel.x, sel.y);
      const at1 = (v: number): number | null => {
        const r = t ? interpAt(t, v) : NaN;
        return Number.isFinite(r) ? r : null;
      };
      return { yKey, y: [at1(at[0]), at1(at[1])] as [number | null, number | null] };
    });
}
