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
// There are two key policies, one per consumer, because the two kinds of map
// are LOOKED UP differently and a sanitizer must not change what a stored map
// resolves to:
//
//   * `keyedRecord` passes keys through VERBATIM. Its callers either key by a
//     genuine string (`plotRecipeIO`'s signature-entry ids, `"y0"`) or
//     iterate with `Object.entries` + `Number(key)` (`lib/plotview.ts`'s
//     `seriesLabels`, read as `seriesLabels[ch]` on the canvas). A
//     non-canonical numeric key from a hand-edited file (`"01"`) therefore
//     stays as written and simply never matches a channel, instead of being
//     silently normalized onto one.
//   * `numKeyedRecord` NORMALIZES each key through `Number` and drops the
//     ones that are not finite numbers. `lib/techniqueViewMemory.ts` needs
//     this: its `labels` map is read by numeric index
//     (`remembered.labels[ch]`), so a `"01"` that survived verbatim would
//     miss and silently take the "never captured a label -> by-index
//     passthrough" branch. Normalizing is what its own pre-BUG-014
//     `strRecord`/`numRecord` helpers did, and this keeps that behaviour
//     while gaining the value validation.
//
//     A channel index is a non-negative integer, so a key is accepted only
//     when `key.trim()` is literally `\d+` (round-5 review F1): `Number("")`
//     and `Number(" ")` are both `0` and finite, so bare `Number.isFinite`
//     let a blank or whitespace-only key from a hand-edited `.dwk` silently
//     relocate onto channel 0. The digits-only check also rejects a decimal
//     (`"1.5"`), hex (`"0x10"`) or scientific-notation (`"1e0"`) spelling
//     that `Number()` alone would still coerce to a finite number, and drops
//     a negative index (`"-1"`) outright rather than parking it unreachable
//     -- channel indices are never negative, so there is nothing for one to
//     mean. A leading zero or surrounding whitespace is still accepted and
//     normalized (`"01"` / `" 1 "` -> `1`), matching what the pre-BUG-014
//     helpers did via `Number`'s own trimming.
//
//     A collision between two spellings of the same channel (`"1"` and
//     `"01"`) keeps the value written under the CANONICAL (no-leading-zero)
//     spelling: `Object.entries` always enumerates array-index-like keys --
//     which is exactly the canonical decimal spelling -- ascending and
//     before any other string key, regardless of the object's own source
//     order, so processing entries in that order and keeping only the FIRST
//     value seen for a key (never overwriting) makes the canonical spelling
//     win either way a hand-edited file orders the two.

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

/** Key-NORMALIZING sibling of `keyedRecord` for a genuinely channel-indexed
 *  map: each key runs through `Number`, so a hand-edited `"01"` lands on
 *  channel 1 the way the pre-BUG-014 helpers put it there, and a key that is
 *  not a non-negative integer at all -- not a finite number (`"x"`), not an
 *  integer (`"1.5"`), or negative (`"-1"`) -- is dropped rather than parked
 *  somewhere unreachable. Values are validated by `guard`, same as
 *  `keyedRecord`. A collision between two spellings of the same channel
 *  keeps the value under the CANONICAL (no-leading-zero) spelling,
 *  regardless of which one the source object wrote first. */
export function numKeyedRecord<T>(v: unknown, guard: (x: unknown) => x is T): Record<number, T> {
  const out: Record<number, T> = {};
  if (typeof v !== "object" || v === null) return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const trimmed = k.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    const key = Number(trimmed);
    if (Number.isInteger(key) && guard(val) && !(key in out)) out[key] = val;
  }
  return out;
}

/** The guard `numKeyedRecord` takes for a numeric map (`errKeys`): a channel
 *  index, so non-finite numbers and every other type are dropped. */
export function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
