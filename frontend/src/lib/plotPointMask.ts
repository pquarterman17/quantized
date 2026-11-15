// Mask points from the plot (origin gap audit 3 N2): which rows a 2-D box
// drag of the Select Rows tool takes, which a free-form lasso of the Lasso
// Mask tool encloses (gap audit 4 G19), and which single data point sits
// under a right-click. Both feed the worksheet's own row exclusion (store/rowState),
// so a masked point is drawn as the existing mask display (a gap, or a muted
// hollow companion) and undo, fits and exports follow. Pure; loaded on demand.
//
// A drawn row is a DATASET row only on a full payload. A reduced one (server
// decimation, a zoom window) carries `rowIds` (routes/plot.py's `rows`): every
// hit is traced back through it, checked against the dataset's own values,
// and refused when it cannot be traced exactly -- never guessed by position.

import { applicableFilter, rowPasses } from "./datafilter";
import type { PlotPayload, PlotSeriesSpec } from "./plotdata";
import { filteredOutSet } from "./rowstate";
import type { Dataset } from "./types";
import { waterfallSourceRows } from "./waterfallOffset";

type Cols = readonly (readonly (number | null)[])[];

const inRange = (v: number | null | undefined, a: number, b: number): v is number =>
  v != null && Number.isFinite(v) && v >= Math.min(a, b) && v <= Math.max(a, b);

/** Is display series `i` a point of the data (a plotted curve, the first
 *  `nBase`, or the muted companion drawing its masked points,
 *  lib/plotdata.maskExcludedPayload) rather than an overlay (a fit, a band)? */
export function isDataSeries(series: readonly PlotSeriesSpec[], nBase: number, i: number): boolean {
  const s = series[i];
  return !!s && (i < nBase || (i < 2 * nBase && s.muted === true && s.kind === "points"));
}

/** A Select Rows drag: its x band, and -- for a 2-D box -- its y edges on
 *  each Y axis the plot has (`y` primary, `y2` secondary). */
export interface PlotPick {
  x0: number;
  x1: number;
  y?: [number, number];
  y2?: [number, number];
}

/** Payload rows with a drawn point inside the box: its X in the band and the
 *  Y of ANY data series (`isDataSeries` -- a masked point counts too, so a box
 *  can unmask) inside the box's edges on THAT series' own axis. */
export function rowsInBox(cols: Cols, series: readonly PlotSeriesSpec[], nBase: number, box: PlotPick): number[] {
  const xs = cols[0] ?? [];
  const ys = series.flatMap((s, i) => {
    const range = (s.axis ?? 0) === 1 ? box.y2 : box.y;
    return isDataSeries(series, nBase, i) && range ? [{ col: cols[i + 1] ?? [], range }] : [];
  });
  const rows: number[] = [];
  for (let r = 0; r < xs.length; r++) {
    if (!inRange(xs[r], box.x0, box.x1)) continue;
    if (ys.some(({ col, range }) => inRange(col[r], range[0], range[1]))) rows.push(r);
  }
  return rows;
}

const same = (a: number | null | undefined, b: number | null | undefined): boolean =>
  a === b || ((a == null || Number.isNaN(a)) && (b == null || Number.isNaN(b)));

/** Is `p` a reduced payload (not the dataset's rows one-to-one)? */
export const isReduced = (p: PlotPayload): boolean => !!(p.rowIds || p.decimated || p.window);

/** The dataset's own plotted X, one per row. */
const fullX = (ds: Dataset, xKey: number | null): number[] =>
  xKey == null || xKey < 0 || xKey >= ds.data.labels.length ? ds.data.time : ds.data.values.map((r) => r[xKey]);

const REFUSED = "this plot shows a reduced set of points that can't be traced exactly to their rows — zoom in further, or pick in the worksheet";

/** A reduced payload's row map, verified: each drawn row's X and plotted Ys
 *  equal its dataset row's. A string (the reason) when it can't be trusted. */
function tracedRows(p: PlotPayload, plotted: readonly number[], ds: Dataset | null, xKey: number | null): number[] | string {
  const cols = p.data as (number | null)[][];
  const ids = p.rowIds;
  if (!ids || !ds || p.blockRows || ids.length !== (cols[0]?.length ?? 0)) return REFUSED;
  const xs = fullX(ds, xKey);
  for (let i = 0; i < ids.length; i++) {
    const r = ids[i];
    const row = ds.data.values[r];
    if (!Number.isInteger(r) || !row || !same(cols[0][i], xs[r])) return REFUSED;
    for (let s = 0; s < plotted.length; s++) if (!same(cols[s + 1]?.[i], row[plotted[s]])) return REFUSED;
  }
  return ids;
}

/** The DATASET rows a Select Rows drag takes: an x band, or a 2-D box. On a
 *  reduced payload the pick runs on the dataset's own full rows (so a point
 *  decimation hid is not skipped), once the drawn rows are traced to them. */
export function pickRows(
  p: PlotPayload,
  plotted: readonly number[],
  ds: Dataset | null,
  xKey: number | null,
  pick: PlotPick,
): { rows: number[] } | { refused: string } {
  const cols = p.data as (number | null)[][];
  const box = pick.y || pick.y2;
  const nBase = plotted.length || p.series.length;
  if (!isReduced(p)) {
    const rows = box ? rowsInBox(cols, p.series, nBase, pick) : rowsInRange(cols[0] ?? [], pick.x0, pick.x1);
    return { rows: waterfallSourceRows(p, rows) };
  }
  const traced = tracedRows(p, plotted, ds, xKey);
  if (typeof traced === "string" || !ds) return { refused: typeof traced === "string" ? traced : REFUSED };
  const xs = fullX(ds, xKey);
  if (!box) return { rows: rowsInRange(xs, pick.x0, pick.x1) };
  const full = [xs, ...plotted.map((c) => ds.data.values.map((r) => r[c]))];
  return { rows: rowsInBox(full, p.series.slice(0, plotted.length), plotted.length, pick) };
}

/** A lasso, in screen px; a point's screen px on its own Y axis (0 = y,
 *  1 = y2), or null when it is not drawn. */
export type Polygon = readonly (readonly [number, number])[];
export type ToPx = (x: number, y: number, axis: 0 | 1) => readonly [number, number] | null;

/** Is (`px`, `py`) inside `poly` (even-odd ray casting)? */
export function insidePolygon(poly: Polygon, px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Rows with a drawn point of ANY data series inside the lasso, tested in
 *  screen space on THAT series' own axis -- so a Y2 curve is hit where it is
 *  drawn, and every row is tested whatever order X runs in. */
export function rowsInPolygon(cols: Cols, series: readonly PlotSeriesSpec[], nBase: number, poly: Polygon, toPx: ToPx): number[] {
  const xs = cols[0] ?? [];
  const ys = series.flatMap((s, i) => (isDataSeries(series, nBase, i) ? [{ col: cols[i + 1] ?? [], axis: ((s.axis ?? 0) === 1 ? 1 : 0) as 0 | 1 }] : []));
  const rows: number[] = [];
  for (let r = 0; r < xs.length; r++) {
    const x = xs[r];
    if (x == null || !Number.isFinite(x)) continue;
    const hit = ys.some(({ col, axis }) => {
      const y = col[r];
      if (y == null || !Number.isFinite(y)) return false;
      const p = toPx(x, y, axis);
      return !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && insidePolygon(poly, p[0], p[1]);
    });
    if (hit) rows.push(r);
  }
  return rows;
}

/** The DATASET rows a lasso encloses. A reduced payload is traced to its
 *  rows first and the test runs on the dataset's own full rows (a point
 *  decimation hid is not skipped); an untraceable one is refused. */
export function lassoRows(
  p: PlotPayload,
  plotted: readonly number[],
  ds: Dataset | null,
  xKey: number | null,
  poly: Polygon,
  toPx: ToPx,
): { rows: number[] } | { refused: string } {
  if (poly.length < 3) return { rows: [] };
  const cols = p.data as (number | null)[][];
  const nBase = plotted.length || p.series.length;
  if (!isReduced(p)) return { rows: waterfallSourceRows(p, rowsInPolygon(cols, p.series, nBase, poly, toPx)) };
  const traced = tracedRows(p, plotted, ds, xKey);
  if (typeof traced === "string" || !ds) return { refused: typeof traced === "string" ? traced : REFUSED };
  const full = [fullX(ds, xKey), ...plotted.map((c) => ds.data.values.map((r) => r[c]))];
  return { rows: rowsInPolygon(full, p.series.slice(0, plotted.length), plotted.length, poly, toPx) };
}

function rowsInRange(xs: readonly (number | null)[], x0: number, x1: number): number[] {
  const rows: number[] = [];
  for (let r = 0; r < xs.length; r++) if (inRange(xs[r], x0, x1)) rows.push(r);
  return rows;
}

/** The dataset row of drawn row `i` (a right-click hit), or why it can't be
 *  named exactly. */
export function traceRow(
  p: PlotPayload,
  i: number,
  plotted: readonly number[],
  ds: Dataset | null,
  xKey: number | null,
): { row: number } | { refused: string } {
  if (!isReduced(p)) {
    const row = waterfallSourceRows(p, [i])[0];
    return row === undefined ? { refused: REFUSED } : { row };
  }
  const traced = tracedRows(p, plotted, ds, xKey);
  return typeof traced === "string" || traced[i] === undefined ? { refused: typeof traced === "string" ? traced : REFUSED } : { row: traced[i] };
}

/** Why row `row` of `ds` is hidden by its data filter ("“T (K)” filter of
 *  “run 3”"), or null when no filter hides it. */
export function filterReason(ds: Dataset, row: number): string | null {
  if (!filteredOutSet(ds).has(row)) return null;
  const f = applicableFilter(ds).find((p) => !rowPasses([p], ds.data, row));
  const col = f === undefined ? "" : f.col < 0 ? String(ds.data.metadata?.x_column_name ?? "X") : (ds.data.labels[f.col] ?? `col ${f.col + 1}`);
  return `the “${col}” filter of “${ds.name}”`;
}

/** The payload row of the drawn point nearest (in pixels) to (`px`, `py`)
 *  among the series `candidate` admits, within `maxPx`; null when none is that
 *  close. `pos(series, row)` gives a point's pixel position (null = not drawn). */
export function nearestPointRow(
  nSeries: number,
  nRows: number,
  candidate: (series: number) => boolean,
  pos: (series: number, row: number) => [number, number] | null,
  px: number,
  py: number,
  maxPx: number,
): { series: number; row: number } | null {
  let best: { series: number; row: number } | null = null;
  let bestD = maxPx * maxPx;
  for (let s = 0; s < nSeries; s++) {
    if (!candidate(s)) continue;
    for (let r = 0; r < nRows; r++) {
      const p = pos(s, r);
      if (!p) continue;
      const d = (p[0] - px) ** 2 + (p[1] - py) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = { series: s, row: r };
      }
    }
  }
  return best;
}
