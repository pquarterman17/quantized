// Load-time sanitizer for a `.dwk`'s `hiddenCols` / `frozenCols`, split from
// lib/worksheetColumnView.ts so it rides in the loader's chunk rather than the
// eager one (scripts/check-bundle-size.mjs).

/** Integer, in-range (`[0, width)`), unique, ascending; `undefined` when
 *  nothing valid remains. */
export function sanitizeHiddenCols(raw: unknown, width: number): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = [...new Set(raw.filter((c): c is number => Number.isInteger(c) && c >= 0 && c < width))].sort((a, b) => a - b);
  return out.length ? out : undefined;
}

/** A positive integer, clamped to the column count; `undefined` otherwise. */
export function sanitizeFrozenCols(raw: unknown, width: number): number | undefined {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 || width <= 0) return undefined;
  return Math.min(raw, width);
}
