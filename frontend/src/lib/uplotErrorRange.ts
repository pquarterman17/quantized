// Error bars in the canvas' AUTOSCALE (screen == export). matplotlib's
// autoscale covers every errorbar artist on X and Y, so the export never cuts a
// bar off; the stat plots' domain already spans their whiskers on screen
// (`Stage/statDrawMarks.barDomainCandidates`). This module gives the XY canvas
// the same rule: an auto-scaled axis covers both ends of every drawn bar.
// Pinned on both sides by `tests/fixtures/wire/xy_error_autoscale.json`.
//
// Only AUTOSCALE widens. A fixed xLim/yLim never reaches here, and a zoom wins:
// uPlot calls the X range function with an explicit `setScale` too, so X widens
// only when handed the data's own [first, last] — what uPlot's autoscale (and
// its double-click reset) passes. A zoom that lands exactly on those ends is
// indistinguishable and widens too. A Y scale is ranged only on autoscale,
// and widens by the bars of the rows inside the current X window, as uPlot
// scans that window for the points themselves.
//
// A plot without error bars gets no range function at all, so its options are
// byte-identical to before. Split out of `lib/uplotOpts.ts` (shrink-only pin).

import type uPlot from "uplot";

import type { ErrorSpan } from "./errorbars";
import type { PlotPayload } from "./plotdata";

/** One series' drawn bars on one scale ("x", or Y axis 0/1): the bar ends at
 *  each payload row (empty where no bar is drawn). */
export interface BarEnds {
  series: number; // 0-based display series
  on: "x" | 0 | 1;
  rows: number[][];
}

type Col = readonly (number | null | undefined)[];
const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** The ends of every bar the canvas draws — `errorSpansPlugin`, or the legacy
 *  symmetric `errorBarsPlugin` for a column with no span — or null when none
 *  is drawable. A bar is drawn where its point has both x and y. */
export function errorReach(
  payload: PlotPayload,
  errorBars: Map<number, (number | null)[]> | undefined,
  errorSpans: Map<number, ErrorSpan[]> | undefined,
): BarEnds[] | null {
  const xs = payload.data[0] as Col;
  const out: BarEnds[] = [];
  payload.series.forEach((s, i) => {
    const ys = (payload.data[i + 1] ?? []) as Col;
    const legacy = errorBars?.get(i + 1);
    const spans: ErrorSpan[] = errorSpans?.get(i + 1) ?? (legacy ? [{ axis: "y", plus: legacy, minus: legacy }] : []);
    for (const { axis, plus, minus } of spans) {
      const base = axis === "x" ? xs : ys;
      const rows = xs.map((x, r) =>
        ok(x) && ok(ys[r]) ? [(base[r] as number) + (plus[r] ?? NaN), (base[r] as number) - (minus[r] ?? NaN)].filter(ok) : [],
      );
      if (rows.some((e) => e.length)) out.push({ series: i, on: axis === "x" ? "x" : s.axis === 1 ? 1 : 0, rows });
    }
  });
  return out.length ? out : null;
}

/** Widen [min, max] by `e`'s ends over rows [r0, r1], skipping ends <= `floor`. */
function widen(e: BarEnds, min: number, max: number, r0: number, r1: number, floor: number): [number, number] {
  for (let r = r0; r <= Math.min(r1, e.rows.length - 1); r++) {
    for (const v of e.rows[r]) {
      if (v <= floor) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  return [min, max];
}

// uPlot's range helpers, to hand a widened domain back to uPlot's OWN default
// rule. Provided by `lib/uplotPaths.ts`, the module that holds every uPlot-
// RUNTIME piece the options builder uses: a runtime import here would evaluate
// uPlot (which needs a browser) wherever `lib/uplotOpts.ts` is imported. Every
// canvas that draws through buildOpts loads that module for its path builders.
let statics: Pick<typeof uPlot, "rangeNum" | "rangeLog"> | null = null;

/** Hand this module uPlot's range helpers (once, from `lib/uplotPaths.ts`). */
export function provideUplotRanges(u: Pick<typeof uPlot, "rangeNum" | "rangeLog">): void {
  statics = u;
}

/** uPlot's own default range for an auto scale (`initScale`'s snapNum/snapLog). */
function uplotDefault(u: uPlot, min: number, max: number, key: string, isX: boolean): uPlot.Range.MinMax {
  const sc = u.scales[key];
  if (!statics) return [min, max];
  if ((sc.distr as number) === 3) return statics.rangeLog(min, max, sc.log ?? 10, false);
  return isX ? [min, max] : statics.rangeNum(min, max, 0.1, true);
}

/** A FLAT [v, v] as uPlot's own autoscale views it (`rangeNum`/`rangeLog`:
 *  1000 reads 0..2000 linear, 100..10000 log), for the full-scan paths. The
 *  export's rule too: `lib/flatAutoscaleFixture.test.ts`. */
export function flatView(v: number, positiveOnly: boolean): [number, number] | null {
  return statics && ((positiveOnly ? statics.rangeLog(v, v, 10, false) : statics.rangeNum(v, v, 0.1, true)) as [number, number]);
}

/** The lowest bar end a log/reciprocal autoscale counts: two decades below
 *  the lowest point. A lower end <= 0 or near zero (sR ~ R on low-count
 *  reflectivity) would stretch the axis many decades; it runs to the floor
 *  instead. `calc/figure_autoscale.py` applies the same rule to the export. */
const barFloor = (min: number, positiveOnly: boolean) => (positiveOnly ? min / 100 : -Infinity);

/** The `range` prop for an auto-scaled X (`on` "x") or Y axis (0 = y, 1 = y2)
 *  that no fixed limit or loop scan already ranges: {} without bars on it, so
 *  the scale is exactly uPlot's own. X spans every row; Y the rows uPlot
 *  scanned for the points (the series' `idxs`, the current X window). */
export function errorRange(reach: BarEnds[] | null, on: "x" | 0 | 1, positiveOnly: boolean): Pick<uPlot.Scale, "range"> {
  const ends = reach?.filter((e) => e.on === on) ?? [];
  if (!ends.length) return {};
  const isX = on === "x";
  return {
    range: (u, min, max, key) => {
      const xs = u.data[0];
      if (min == null) return [null, null];
      if (isX && (min !== xs[0] || max !== xs[xs.length - 1])) return uplotDefault(u, min, max, key, isX);
      const floor = barFloor(min, positiveOnly);
      for (const e of ends) {
        const s = u.series[e.series + 1];
        if (s?.show === false) continue;
        const [i0, i1] = (!isX && s?.idxs) || [0, Infinity];
        [min, max] = widen(e, min, max, i0, i1, floor);
      }
      return uplotDefault(u, min, max, key, isX);
    },
  };
}

/** `payload` with every visible x bar end appended as an extra x value — what
 *  `fullXExtents` scans for a loop's X. The appended rows carry a finite y in
 *  every column, so a waterfall layout's drawn-point check counts them. */
export function withXBarRows(payload: PlotPayload, reach: BarEnds[] | null, hidden: boolean[] | undefined): PlotPayload {
  const v = (reach ?? []).filter((e) => e.on === "x" && !hidden?.[e.series]).flatMap((e) => e.rows.flat());
  if (!v.length) return payload;
  const [xs, ...ys] = payload.data as Col[];
  return { ...payload, data: [[...xs, ...v], ...ys.map((y) => [...y, ...v.map(() => 0)])] as PlotPayload["data"] };
}

/** Full-scan [min, max] of the finite values (and, with `reach`, the visible y
 *  bars' ends) across every visible series on one scale — the manual
 *  counterpart of uPlot's auto-range for non-monotonic x, where uPlot's own
 *  scan window (derived from a binary search over x) is meaningless. Log AND
 *  reciprocal scales consider positive values only (MAIN #12 — reciprocal has
 *  the same domain restriction as log; see `reciprocalTransform`'s doc).
 *  Returns null when nothing qualifies (leave uPlot's default behaviour
 *  alone). Moved verbatim from `lib/uplotOpts.ts`, plus `reach`. */
export function fullYExtents(
  payload: PlotPayload,
  hidden: boolean[] | undefined,
  axis: 0 | 1,
  positiveOnly: boolean,
  reach: BarEnds[] | null = null,
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  payload.series.forEach((s, i) => {
    if ((s.axis ?? 0) !== axis || hidden?.[i]) return;
    for (const v of payload.data[i + 1] ?? []) {
      if (v == null || !Number.isFinite(v) || (positiveOnly && v <= 0)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  });
  const floor = barFloor(min, positiveOnly);
  for (const e of reach ?? []) {
    if (e.on === axis && !hidden?.[e.series]) [min, max] = widen(e, min, max, 0, Infinity, floor);
  }
  if (min > max) return null;
  const flat = min === max && flatView(min, positiveOnly);
  if (flat) return flat;
  if (positiveOnly) return [min / 1.1, max * 1.1];
  const pad = (max - min || Math.abs(max) || 1) * 0.1; // mirror uPlot's soft pad
  // ...and its soft zero: data on one side of zero never pad across it.
  return [min < 0 ? min - pad : Math.max(0, min - pad), max >= 0 ? max + pad : Math.min(0, max + pad)];
}
