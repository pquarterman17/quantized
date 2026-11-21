// Loop-based min / max / push for DATA-SIZED arrays. `Math.min(...arr)` and
// `arr.push(...more)` pass every element as a call argument, and a 120k+ row
// column overflows the engine's argument cap ("RangeError: Maximum call stack
// size exceeded"), which blanked the whole app on a large dataset. Use these
// for anything that scales with rows, points, series or peaks; a spread over
// a small fixed literal is fine.

/** `Math.min(...a)` without the argument cap: `Infinity` when empty, `NaN`
 *  when any element is NaN (same results as `Math.min`). */
export function minOf(a: ArrayLike<number>): number {
  let m = Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v !== v) return NaN;
    if (v < m) m = v;
  }
  return m;
}

/** `Math.max(...a)` without the argument cap: `-Infinity` when empty. */
export function maxOf(a: ArrayLike<number>): number {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v !== v) return NaN;
    if (v > m) m = v;
  }
  return m;
}
