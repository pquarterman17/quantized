// The `auto` tick labels of the interactive canvas, moved out of
// lib/uplotOpts.ts (its line pin) when UX audit 8 #8 gave them publication
// style: no digit grouping ("60000", never "60,000" or a de-DE "60.000"), a
// true minus (U+2212, as matplotlib draws it in the export), and on a linear
// axis whose ticks are all below 1e-2 or reach 1e4 a common ×10ⁿ factor drawn
// at the axis end -- where the export draws its offset text
// (`calc/tick_multiplier.py`), so screen and PDF agree. The rule itself is
// `autoTickExponent` below. Kept out of lib/tickFormat.ts: that module is the
// lazily-loaded controls' vocabulary, and importing it here would pull it eager.

import type uPlot from "uplot";

import { fmtCfg } from "./format";
import { divideFont, divideLabelSpot, divideTopPadding, topAxisLift, type AxisSide } from "./axisDivideLabel";
import { logDecadeLabels, sup } from "./logTicks";
import { decimalsForIncrement, pow10 } from "./ticks";
import type { AxisFormat } from "./types";

export { sup };

/** "×10ⁿ": the factor text both engines draw at the axis end (`calc/tick_multiplier.py`). */
export const timesTen = (n: number): string => `×10${sup(n)}`;

/** UX audit 8 #8: the common ×10ⁿ factor of an AUTO linear axis. n is the
 *  order of magnitude of the largest |tick| drawn, used only when that is
 *  below 1e-2 or at least 1e4 (Origin's auto factor, matplotlib's offset
 *  text, Prism's "power of ten"); null = plain labels. The export half is
 *  `calc/tick_multiplier.py`'s `auto_tick_exponent`, pinned by the shared
 *  fixture tests/fixtures/wire/tick_multiplier.json. */
export function autoTickExponent(ticks: readonly (number | null | undefined)[]): number | null {
  let max = 0, lo = Infinity, hi = -Infinity;
  for (const v of ticks) {
    if (v == null || !Number.isFinite(v)) continue;
    max = Math.max(max, Math.abs(v));
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!(max > 0)) return null;
  // A tight range far from zero (1000.001..1000.002): its mantissas would need
  // more than 5 digits, so no factor -- the export's offset text is off too.
  if (hi > lo && (hi - lo) / max < 1e-3) return null;
  const n = Math.floor(Math.log10(max) + 1e-9);
  return n <= -3 || n >= 4 ? n : null;
}

/** Whether an axis' auto labels may take the ×10ⁿ factor: no explicit
 *  format, divide-by, prefix / suffix, custom ticks, breaks, probability
 *  scale or crossing (each already decides how the numbers read, or, for a
 *  crossing axis, the export hides the factor with the frame's labels). */
export function autoMultiplierAllowed(fmt: AxisFormat | null | undefined): boolean {
  if (!fmt) return true;
  return fmt.mode === "auto" && !(fmt.divide && fmt.divide !== 1) && !fmt.prefix && !fmt.suffix
    && !fmt.custom && !fmt.breaks?.length && !fmt.prob && fmt.cross == null;
}

/** A uPlot axis `values` callback: maps tick split values to label strings. */
export type TickValues = (
  self: uPlot,
  splits: number[],
  axisIdx: number,
  foundSpace: number,
  foundIncr: number,
) => (string | number | null)[];

/** The smallest positive gap between consecutive (sorted, finite, non-null)
 *  tick SPLITS — the increment that actually governs label precision,
 *  independent of which generator produced the splits. uPlot's own
 *  `foundIncr` (the 5th `values` argument) reflects a generic linear-
 *  increment search over `[scaleMin, scaleMax]` that ALWAYS runs internally,
 *  even when a custom `axis.splits` override is supplied (lib/uplotOpts.ts'
 *  `fixedLogAxisSplits`/`reciprocalAxisSplits`) — so `foundIncr` can
 *  silently disagree with the spacing of the splits actually drawn there.
 *  Deriving the increment directly from the splits array is correct
 *  regardless of scale/override, and is the primary source; `foundIncr` is
 *  only a fallback for the (single-split, no diffable pair) degenerate
 *  case. */
export function splitsIncrement(splits: readonly (number | null | undefined)[], foundIncr: number): number {
  const vals = splits
    .filter((v): v is number => v != null && Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 1; i < vals.length; i++) {
    const gap = vals[i] - vals[i - 1];
    if (gap > 0 && gap < min) min = gap;
  }
  return Number.isFinite(min) ? min : foundIncr;
}

/** Strip a rounded-to-zero value's leading minus sign: a legitimately
 *  non-zero split (e.g. -0.00003) can still format as "-0"/"-0.000"/
 *  "-0.0e+0" once rounded to the tick's display precision, which is never
 *  meaningful data (MAIN #20 — the owner's screenshot showed a bare "-0"
 *  tick label on a dense M-H moment axis). Works after ANY formatter by
 *  re-parsing the FORMATTED string rather than inspecting the pre-format
 *  float. */
export function stripNegZero(formatted: string): string {
  if (!formatted.startsWith("-")) return formatted;
  const bare = formatted.slice(1);
  return Number(bare.replace(/,/g, "")) === 0 ? bare : formatted;
}

/** The typographic minus matplotlib draws (`axes.unicode_minus`). */
const trueMinus = (s: string): string => (s.startsWith("-") ? `−${s.slice(1)}` : s);

/** The Numbers prefs' display locale / Scientific notation (lib/format.ts hooks): on screen only. */
const tickDisp = (label: string, v?: number): string => fmtCfg.h.tick?.(label, v) || label;

const autoNumberFormatCache = new Map<number, Intl.NumberFormat>();
/** `d`: `decimalsForIncrement`'s 0..20. A fixed "en-US" with no grouping:
 *  "60000" and "0.5" in every locale, as the export prints them. */
function autoNumberFormat(d: number, pad: boolean): Intl.NumberFormat {
  // A linear axis shows one decimal count (audit 6 P3): "0.0090" beside "0.0095", as Origin pads --
  // up to 5 decimals: a finer increment (where matplotlib turns to an offset) keeps labels unpadded.
  const min = pad && d <= 5 ? d : 0, key = d + 21 * min;
  let nf = autoNumberFormatCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: d, useGrouping: false });
    autoNumberFormatCache.set(key, nf);
  }
  return nf;
}

/** Each plot's drawn factor exponent per axis index (only axes that may take one). */
const factors = new WeakMap<object, Map<number, number>>();

/** The `auto` mode `values` callback (MAIN #20: uPlot's own default caps at
 *  3 fraction digits whatever the increment, which collapsed a dense moment
 *  axis into duplicate labels). Decimals follow the splits' increment; on a
 *  linear axis (`pad`) every label carries the same count (audit 6 P3); with
 *  `multiplier`, an axis whose ticks are all tiny or huge shows mantissas and
 *  records its exponent for `autoMultiplierPlugin` to draw. */
const autoValues = (pad: boolean, multiplier: boolean): TickValues => (u, splits, axisIdx, _foundSpace, foundIncr) => {
  const incr = splitsIncrement(splits, foundIncr);
  const n = multiplier ? autoTickExponent(splits) : null;
  if (multiplier && u) {
    let map = factors.get(u);
    if (!map) factors.set(u, (map = new Map()));
    if (n == null) map.delete(axisIdx);
    else map.set(axisIdx, n);
  }
  if (n != null) {
    // One tick: the export's increment is 0 (no second value to diff), so the
    // mantissa decimals agree rather than following uPlot's foundIncr.
    const k = pow10(n), d = Math.min(20, decimalsForIncrement(splitsIncrement(splits, 0) / k));
    return splits.map((v) => (v == null ? null : tickDisp(trueMinus(stripNegZero((v / k).toFixed(d))))));
  }
  const nf = autoNumberFormat(decimalsForIncrement(incr), pad);
  return splits.map((v) => (v == null ? null : tickDisp(trueMinus(stripNegZero(nf.format(v))), v)));
};
/** A linear axis (with the ×10ⁿ factor), a linear axis without it (Y3+), and
 *  log / reciprocal (uneven ticks: unpadded, no factor). */
export const autoTickValues = autoValues(true, true), autoPlainValues = autoValues(true, false), autoUnpadded = autoValues(false, false);

/** Auto labels on a log axis: decade anchors on a multi-decade view, the
 *  ordinary auto labels on a sub-decade one (lib/logTicks.ts). */
export const autoLogTickValues: TickValues = (u, splits, ...rest) => logDecadeLabels(splits) ?? autoUnpadded(u, splits, ...rest);

/** uPlot's own top padding beside a y axis: a third of its default x axis size (50). */
const UPLOT_AUTO_TOP = 17;

/** Whether uPlot draws this axis now (`_show` is its own runtime flag: an
 *  axis whose scale has no data is hidden without a `values` call). */
const drawn = (axis: uPlot.Axis | undefined): axis is uPlot.Axis =>
  !!axis && axis.show !== false && (axis as { _show?: boolean })._show !== false;

/** The top padding: uPlot's own (or `base`), widened to the divide-by band
 *  (lib/axisDivideLabel.ts) while a factor-capable axis (`capable`: index and
 *  scale key) that sits VERTICAL (by its side, so Exchange X-Y holds) draws a
 *  factor or spans a ×10ⁿ range. The scale test lets every panel of an
 *  X-break (whose inner panels draw no Y labels) reserve the same band, so
 *  the plot areas stay aligned. */
export function autoFactorTopPad(base: uPlot.Padding[0], capable: readonly (readonly [number, string])[]): uPlot.Padding[0] {
  if (!capable.length) return base;
  return (u, side, sides, cycle) => {
    const own = typeof base === "function" ? base(u, side, sides, cycle) : base ?? ((sides[1] || sides[3]) && !sides[0] ? UPLOT_AUTO_TOP : 0);
    let need = 0;
    for (const [idx, key] of capable) {
      const axis = u.axes[idx], sc = u.scales[key];
      const at: number = axis?.side ?? (idx === 0 ? 2 : 3);
      if (!drawn(axis) || (at !== 1 && at !== 3)) continue;
      if (factors.get(u)?.has(idx) || (sc && autoTickExponent([sc.min, sc.max]) != null)) {
        const pr = devicePixelRatio || 1;
        need = Math.max(need, divideTopPadding(`${divideFont(axis.font, pr).px / pr}px`));
      }
    }
    return Math.max(own, need);
  };
}

/** A uPlot `draw` hook: each recorded ×10ⁿ at its axis end, in the axis'
 *  tick font and colour (lib/axisDivideLabel.ts' spot, shared with the Axis
 *  dialog's divide-by factor and the export's offset text). */
export function drawAutoFactors(u: uPlot): void {
  const map = factors.get(u);
  if (!map?.size) return;
  const pr = devicePixelRatio || 1;
  const { ctx } = u;
  ctx.save();
  for (const [idx, n] of map) {
    const axis = u.axes[idx];
    if (!drawn(axis)) continue;
    const at = divideFont(axis.font, pr);
    const spot = divideLabelSpot((axis.side ?? (idx === 0 ? 2 : 3)) as AxisSide, u.bbox, pr, at.px, topAxisLift(u, pr));
    const stroke = axis.stroke as unknown;
    ctx.fillStyle = typeof stroke === "function" ? String((stroke as (u: uPlot, i: number) => unknown)(u, idx)) : String(stroke ?? "#000");
    ctx.font = at.font;
    ctx.textAlign = spot.align;
    ctx.textBaseline = spot.baseline;
    ctx.fillText(timesTen(n), spot.x, spot.y);
  }
  ctx.restore();
}
