// The "s", or not.
//
// `x === 1 ? "" : "s"` appeared ~20 times across the eager store modules, and
// where the counted expression is long (`resolution.unmatched.length === 1 ? ""
// : "s"`) it repeats that expression in full. This is the single place that
// decision lives now. Extracted under the eager-bundle ratchet
// (frontend/scripts/check-bundle-size.mjs), whose guidance is that an
// over-budget measurement is usually duplicated logic — it was.
export const plural = (n: number): string => (n === 1 ? "" : "s");
