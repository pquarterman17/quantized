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

/** The column as a plain array: a typed one copied, a plain one returned as is. */
export const plainColumn = <V>(col: ArrayLike<V>): V[] => (Array.isArray(col) ? (col as V[]) : Array.from(col));
