// Stacking (Origin's stacked column / stacked bar / stacked area): a series
// with `SeriesStyle.stack` sits on the running total of the stacked series
// plotted before it on the SAME Y axis, row by row (the shared X column).
// A missing or non-finite value adds nothing to the total. The export does
// the same in `calc/figure_bars.py` (`stacked_series`). Bars start at the
// total below instead of zero (`lib/uplotBars.barPaths`); an area is drawn
// here, its line at the new total and its fill between the two totals; the
// autoscale covers both totals (`stackReach`, merged by `errorReach`).
// Hand-rolled on uPlot's public pixel mapping with a type-only import, like
// `uplotBars`, so the series builder needs no uPlot runtime.
import type uPlot from "uplot";

import type { SeriesStyle } from "./seriesStyleTypes";
import type { BarEnds } from "./uplotErrorRange";

type Col = readonly (number | null | undefined)[];
const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** The uPlot data columns (1-based) of the stacked series below display
 *  series `i`: earlier stacked series on the same Y axis; [] when `i` is not
 *  stacked or is the first of its stack. */
export function stackedBelow(
  styles: readonly (SeriesStyle | undefined)[] | undefined,
  axes: readonly (number | undefined)[],
  i: number,
): number[] {
  if (!styles?.[i]?.stack) return [];
  const below: number[] = [];
  for (let j = 0; j < i; j++) if (styles[j]?.stack && (axes[j] ?? 0) === (axes[i] ?? 0)) below.push(j + 1);
  return below;
}

/** A floating column (Origin's FloatCol): a series flagged `float: "high"` that
 *  directly follows one flagged `"low"` on the same Y axis draws bars from the
 *  low series' value to its own, row by row (`calc/figure_bars.floating_series`
 *  pairs the same way on export). Returns the uPlot data column (1-based) of the
 *  low series when display series `i` is such a high, else null. */
export function floatLowColumn(
  styles: readonly (SeriesStyle | undefined)[] | undefined,
  axes: readonly (number | undefined)[],
  i: number,
): number | null {
  const paired = i > 0 && styles?.[i]?.float === "high" && !!styles[i]?.bars && styles[i - 1]?.float === "low";
  return paired && (axes[i - 1] ?? 0) === (axes[i] ?? 0) ? i : null;
}

/** True when display series `i` is the low of a floating pair: it draws nothing
 *  of its own (the bar spans it to the high). */
export const floatIsLow = (
  styles: readonly (SeriesStyle | undefined)[] | undefined,
  axes: readonly (number | undefined)[],
  i: number,
): boolean => styles?.[i]?.float === "low" && floatLowColumn(styles, axes, i + 1) !== null;

/** The running total of the `below` columns at row `r`. */
export function stackBase(data: readonly Col[], below: readonly number[], r: number): number {
  let sum = 0;
  for (const c of below) {
    const v = data[c]?.[r];
    if (ok(v)) sum += v;
  }
  return sum;
}

/** The ends a stacked series' autoscale must cover: its base and its new
 *  total at every row it draws, on its own Y axis. */
export function stackReach(
  series: readonly { axis?: number }[],
  data: readonly Col[],
  styles: readonly (SeriesStyle | undefined)[],
): BarEnds[] {
  const axes = series.map((s) => s.axis);
  const out: BarEnds[] = [];
  series.forEach((s, i) => {
    if (!styles[i]?.stack) return;
    const below = stackedBelow(styles, axes, i);
    const ys = data[i + 1] ?? [];
    const rows = data[0].map((x, r) => (ok(x) && ok(ys[r]) ? [stackBase(data, below, r) + ys[r], stackBase(data, below, r)] : []));
    if (rows.some((e) => e.length)) out.push({ series: i, on: s.axis ?? 0, rows });
  });
  return out;
}

/** A stacked area: the line at the new total, the fill between the total
 *  below and it. A row with no value breaks both. */
export const stackedAreaPaths =
  (below: readonly number[]): uPlot.Series.PathBuilder =>
  (u, seriesIdx, idx0, idx1) => {
    const xs = u.data[0];
    const ys = u.data[seriesIdx];
    const scale = u.series[seriesIdx].scale ?? "y";
    const stroke = new Path2D();
    const fill = new Path2D();
    let run: { x: number; top: number; base: number }[] = [];
    const flush = () => {
      run.forEach((p, k) => (k ? stroke.lineTo(p.x, p.top) : stroke.moveTo(p.x, p.top)));
      if (run.length > 1) {
        run.forEach((p, k) => (k ? fill.lineTo(p.x, p.top) : fill.moveTo(p.x, p.top)));
        for (let k = run.length - 1; k >= 0; k--) fill.lineTo(run[k].x, run[k].base);
        fill.closePath();
      }
      run = [];
    };
    for (let i = idx0; i <= idx1; i++) {
      const x = xs[i];
      const y = ys[i];
      if (x == null || !ok(y)) {
        flush();
        continue;
      }
      const base = stackBase(u.data as unknown as Col[], below, i);
      run.push({ x: u.valToPos(x, "x", true), top: u.valToPos(base + y, scale, true), base: u.valToPos(base, scale, true) });
    }
    flush();
    return { stroke, fill };
  };
