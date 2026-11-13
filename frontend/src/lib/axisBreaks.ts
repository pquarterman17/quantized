// Y-axis breaks (Origin's "Break" on the Axis dialog) -- the shared math of a
// BROKEN LINEAR AXIS, mirrored one-for-one by `src/quantized/calc/
// axis_breaks.py` so the canvas and the export place every point and every
// tick at the same spot. Both halves read `tests/fixtures/wire/
// axis_breaks.json`.
//
// A break `[lo, hi]` ELIDES that stretch of the axis: values at or below `lo`
// keep their place, values at or above `hi` slide down by the elided length,
// and a small fixed GAP stands where the stretch was (the two diagonal marks
// are drawn there). The axis stays ONE axis -- one frame, one set of series,
// one legend -- which is how Origin draws a break, and why this is a scale
// transform rather than the paneled layout the X break uses
// (`lib/facet.breakPayloads`).
//
// Pure, dependency-free. Loaded on demand with `lib/axisExtras.ts`; the eager
// side only validates the stored shape (`axisFormat.normalizeBreaks`).

export type AxisBreak = readonly [number, number];

/** The share of the KEPT data span one break's gap occupies. */
export const BREAK_GAP_FRACTION = 0.04;
/** Major ticks aimed at across the kept span when no increment is typed. */
export const BREAK_TARGET_TICKS = 6;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** `v` with every elided stretch below it removed (the gap not yet added):
 *  the coordinate along the KEPT axis. Monotonic, flat across a break. */
export function elide(v: number, breaks: readonly AxisBreak[]): number {
  let out = v;
  for (const [lo, hi] of breaks) out -= Math.min(Math.max(v - lo, 0), hi - lo);
  return out;
}

/** The inverse of `elide` for a kept coordinate: a coordinate sitting exactly
 *  on a break maps to its LOWER edge. */
export function unelide(c: number, breaks: readonly AxisBreak[]): number {
  let out = c;
  for (const [lo, hi] of breaks) if (out > lo) out += hi - lo;
  return out;
}

/** The gap one break occupies, in data units: a fixed share of the kept span
 *  of the drawn data `[dataMin, dataMax]` (1 when that span is degenerate). */
export function breakGap(breaks: readonly AxisBreak[], dataMin: number, dataMax: number): number {
  const kept = elide(dataMax, breaks) - elide(dataMin, breaks);
  return BREAK_GAP_FRACTION * (kept > 0 && Number.isFinite(kept) ? kept : 1);
}

/** Data value -> position along the broken axis (uPlot's `fwd`, matplotlib's
 *  forward function): the kept coordinate plus `gap` per break passed; inside
 *  a break the value runs linearly across the gap. */
export function breakForward(v: number, breaks: readonly AxisBreak[], gap: number): number {
  let out = elide(v, breaks);
  for (const [lo, hi] of breaks) out += gap * clamp01((v - lo) / (hi - lo));
  return out;
}

/** The inverse of `breakForward` (uPlot's `bwd`): a position inside a gap
 *  maps back into the elided stretch. */
export function breakBackward(p: number, breaks: readonly AxisBreak[], gap: number): number {
  let shift = 0; // position minus value just below the break being tested
  for (const [lo, hi] of breaks) {
    const at = lo + shift;
    if (p <= at) break;
    if (p < at + gap) return lo + ((p - at) / gap) * (hi - lo);
    shift += gap - (hi - lo);
  }
  return p - shift;
}

const pow10 = (e: number): number => (e >= 0 ? 10 ** e : 1 / 10 ** -e);

/** A 1-2-5 step for `span` at about `target` intervals. */
export function niceBreakStep(span: number, target = BREAK_TARGET_TICKS): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / target;
  const mag = pow10(Math.floor(Math.log10(raw)));
  const residual = raw / mag;
  return (residual < 1.5 ? 1 : residual < 3 ? 2 : residual < 7 ? 5 : 10) * mag;
}

/** The shortest visible stretch of `[min, max]` between breaks (the kept
 *  segments a broken axis draws), or Infinity when none is cut. */
function shortestSegment(min: number, max: number, breaks: readonly AxisBreak[]): number {
  let shortest = Infinity;
  let start = min;
  for (const [lo, hi] of breaks) {
    if (hi <= min || lo >= max) continue;
    if (lo > start) shortest = Math.min(shortest, lo - start);
    start = Math.max(start, hi);
  }
  if (max > start && shortest !== Infinity) shortest = Math.min(shortest, max - start);
  return shortest;
}

/** The automatic step of a broken axis showing `[min, max]`: a 1-2-5 step for
 *  the KEPT span (so an elided stretch does not thin the ticks), made finer
 *  when that would leave the shortest segment with barely one tick (the live
 *  check: a 1..5 cluster under a 1000-unit one got a single "5"), but never so
 *  fine the axis carries more than about four times the usual tick count. */
export function autoBreakStep(min: number, max: number, breaks: readonly AxisBreak[]): number {
  const kept = elide(max, breaks) - elide(min, breaks);
  const base = niceBreakStep(kept);
  const shortest = shortestSegment(min, max, breaks);
  if (!Number.isFinite(shortest)) return base;
  return Math.max(niceBreakStep(kept, 4 * BREAK_TARGET_TICKS), Math.min(base, niceBreakStep(shortest, 3)));
}

/** Major ticks of a broken axis showing `[min, max]`: whole multiples of the
 *  step (the typed increment, else `autoBreakStep`), never strictly inside a
 *  break. */
export function breakTicks(min: number, max: number, breaks: readonly AxisBreak[], step?: number | null): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return [];
  const st = step != null && step > 0 && Number.isFinite(step) ? step : autoBreakStep(min, max, breaks);
  const first = Math.ceil(min / st - 1e-9);
  const last = Math.floor(max / st + 1e-9);
  if (last - first > 2000) return [];
  const out: number[] = [];
  for (let k = first; k <= last; k++) {
    const v = Number((k * st).toPrecision(12));
    if (!breaks.some(([lo, hi]) => v > lo && v < hi)) out.push(v);
  }
  return out;
}

/** The auto range of a broken axis over data `[dataMin, dataMax]`: 10% of the
 *  KEPT span each side, never across zero (the canvas' soft zero) -- padding
 *  by the full span would spend most of the axis on the elided stretch. */
export function breakAutoRange(dataMin: number, dataMax: number, breaks: readonly AxisBreak[]): [number, number] {
  const cLo = elide(dataMin, breaks);
  const cHi = elide(dataMax, breaks);
  const pad = (cHi > cLo ? cHi - cLo : Math.abs(cHi) || 1) * 0.1;
  const lo = unelide(cLo - pad, breaks);
  const hi = unelide(cHi + pad, breaks);
  return [dataMin >= 0 && lo < 0 ? 0 : lo, dataMax <= 0 && hi > 0 ? 0 : hi];
}
