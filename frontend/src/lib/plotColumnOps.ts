// A PlotPayload column is a plain `(number | null)[]` OR a `Float64Array`:
// the binary column transport (lib/api/plotColumns.ts) hands out a typed
// array for a gap-free column. Two things break on one: its own `.map`
// coerces a returned `null` to 0 (a drawn point where a gap belongs), and
// JSON writes it as an object. So a layer that can write a gap maps through
// `mapColumn`, and one that persists a column copies it with `plainColumn`.
// Reading by index, `.slice`, `for…of` and uPlot itself are all typed-safe.

/** `col.map(fn)` that always returns a plain array, so a `null` stays `null`. */
export function mapColumn<V, T>(col: ArrayLike<V>, fn: (v: V, r: number) => T): T[] {
  return Array.isArray(col) ? (col as V[]).map(fn) : Array.from(col, fn);
}

/** A split level's cell for one row (S4 + per-level masking). A row of ANOTHER level is `undefined`: uPlot's
 *  line builder skips it and draws across, so interleaved levels (A B C A B C) stay connected. A row of
 *  THIS level that is not finite is `null`, which breaks the line (uPlot 1.6.32 `findGaps` tests `=== null`),
 *  exactly as the export's matplotlib line breaks at a NaN. `spanGaps` must stay off, or the null is bridged
 *  (the same contract as lib/plotUngap.ts's filler). */
export function levelCell(own: boolean, v: number | null | undefined): number | null | undefined {
  if (!own) return undefined;
  return v !== null && v !== undefined && Number.isFinite(v) ? v : null;
}

/** The column as a plain array: a typed one copied, a plain one returned as is. */
export const plainColumn = <V>(col: ArrayLike<V>): V[] => (Array.isArray(col) ? (col as V[]) : Array.from(col));
