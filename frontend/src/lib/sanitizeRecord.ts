// ONE value-validating record sanitizer for every restore path (BUG-014
// round 4).
//
// Three restore paths carry the SAME per-channel `seriesLabels` map, and
// until this round only two of them validated its values: `plotRecipeIO`'s
// `strKeyedRecord` and `techniqueViewMemory`'s `strRecord` each kept a
// private copy, while `lib/plotview.ts`'s `sanitizePlotView` — the `.dwk`
// path, i.e. the one a hand-edited or corrupted document actually arrives
// through — cast the whole object through unchecked. A number surviving that
// cast reached `buildOpts` and crashed the Stage canvas with an uncaught
// `TypeError: s.includes is not a function` (`lib/richtext.ts`'s `hasMarkup`)
// while also putting `label: 42` on the facet export wire (a 422). So the
// copies became one function, here, in a leaf module all three can import
// without a cycle (both siblings already import `plotview`).
//
// Keys are passed through VERBATIM — the caller's key type is a view on the
// object's own string keys (a channel-indexed `Record<number, string>` is
// still `{"1": ...}` at runtime), so a non-canonical numeric key from a
// hand-edited file (`"01"`) stays as written and simply never matches a
// channel, instead of being silently normalized onto one.

/** Every entry of `v` whose VALUE passes `guard`, in the object's own key
 *  order; `{}` for a non-object. Never throws — a defective entry is
 *  dropped, never the whole map (the degrade every `.dwk`/recipe field
 *  follows). */
export function keyedRecord<T, K extends PropertyKey = string>(
  v: unknown,
  guard: (x: unknown) => x is T,
): Record<K, T> {
  const out = {} as Record<K, T>;
  if (typeof v !== "object" || v === null) return out;
  const sink = out as Record<string, T>;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (guard(val)) sink[k] = val;
  return out;
}

/** The guard `keyedRecord` takes for a display-string map (`seriesLabels`,
 *  `labels`): the values are rendered VERBATIM on canvas and shipped verbatim
 *  on the export wire, so anything but a string is dropped. */
export function isString(x: unknown): x is string {
  return typeof x === "string";
}
