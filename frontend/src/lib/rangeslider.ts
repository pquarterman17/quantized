// Dual-thumb range-slider value math (ORIGIN_GAP #53 item 7a — the
// primitives.RangeSlider). Pure: clamps a candidate [lo, hi] pair to the
// slider's [min, max] domain, snaps to `step`, and keeps lo ≤ hi by pushing
// the OTHER thumb when a drag would cross it — the standard two-overlapping-
// <input type="range"> idiom's expected behavior (native dual sliders don't
// do this for you; each <input> clamps independently).

export interface RangeValue {
  lo: number;
  hi: number;
}

/** Snap `v` to the nearest `step` above `min`, then clamp into [min, max].
 *  `step <= 0` disables snapping (continuous). */
export function snapToStep(v: number, min: number, max: number, step: number): number {
  const snapped = step > 0 ? min + Math.round((v - min) / step) * step : v;
  return Math.min(max, Math.max(min, snapped));
}

/** Commit a drag of the LOW thumb to `v`: clamp to the domain, snap to
 *  `step`, and never exceed the current high value (pushes `hi` up only if
 *  the domain itself forces it — i.e. min > hi, which shouldn't happen for a
 *  well-formed [min, max]). */
export function clampLow(v: number, hi: number, min: number, max: number, step = 0): RangeValue {
  const lo = Math.min(snapToStep(v, min, max, step), hi);
  return { lo, hi };
}

/** Commit a drag of the HIGH thumb to `v`: clamp to the domain, snap to
 *  `step`, and never go below the current low value. */
export function clampHigh(v: number, lo: number, min: number, max: number, step = 0): RangeValue {
  const hi = Math.max(snapToStep(v, min, max, step), lo);
  return { lo, hi };
}

/** Normalize an arbitrary candidate [lo, hi] pair into the domain: clamps
 *  both ends to [min, max], snaps to `step`, and swaps if lo > hi. Used when
 *  loading a persisted filter value that may now be out of range (e.g. after
 *  a re-import narrowed the column's data range). */
export function clampRange(lo: number, hi: number, min: number, max: number, step = 0): RangeValue {
  let a = snapToStep(lo, min, max, step);
  let b = snapToStep(hi, min, max, step);
  if (a > b) [a, b] = [b, a];
  return { lo: a, hi: b };
}
