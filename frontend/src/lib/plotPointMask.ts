// Mask points from the plot (origin gap audit 3 N2): which rows a 2-D box
// drag of the Select Rows tool takes, and which single data point sits under
// a right-click. Both feed the worksheet's own row exclusion (store/rowState),
// so a masked point is drawn as the existing mask display (a gap, or a muted
// hollow companion) and undo, fits and exports follow. Pure; the box's rows
// are computed eagerly at drag end, the point test loads with the lazy menu.

import type { PlotSeriesSpec } from "./plotdata";

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

/** Payload rows with a drawn point inside the box [x0,x1] x [y0,y1]: its X in
 *  the band and the Y of ANY data series (`isDataSeries` -- a masked point
 *  counts too, so a box can unmask) on the box's own axis (`onY2`: the
 *  secondary one) inside the box. */
export function rowsInBox(
  cols: Cols,
  series: readonly PlotSeriesSpec[],
  nBase: number,
  box: { x0: number; x1: number; y0: number; y1: number; onY2: boolean },
): number[] {
  const xs = cols[0] ?? [];
  const ys = series.flatMap((s, i) =>
    isDataSeries(series, nBase, i) && ((s.axis ?? 0) === 1) === box.onY2 ? [cols[i + 1] ?? []] : [],
  );
  const rows: number[] = [];
  for (let r = 0; r < xs.length; r++) {
    if (!inRange(xs[r], box.x0, box.x1)) continue;
    if (ys.some((col) => inRange(col[r], box.y0, box.y1))) rows.push(r);
  }
  return rows;
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
