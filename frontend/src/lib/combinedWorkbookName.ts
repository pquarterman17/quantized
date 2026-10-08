// The Combine Workbooks dialog's name pre-fill (L0.34), moved verbatim out of
// lib/workbookCombine.ts in bundle diet slice 24: only the lazy dialog calls
// it, so it ships with it instead of in the eager bundle. Import it by this
// path; workbookCombine.ts does not re-export it (architecture.test.ts,
// DRAGGED_OUT).

const MIN_SUGGESTABLE_PREFIX = 3;

/** The longest shared basename prefix across `names` (extension stripped),
 *  "when one is clear" per L0.34 -- every name must actually agree on a
 *  non-trivial prefix (>=3 chars; a 1-2 char match is noise, not a suggested
 *  identity) or this returns undefined rather than a misleading guess.
 *  Fewer than two names never has a "shared" anything to suggest FROM. */
export function suggestCombinedWorkbookName(names: readonly string[]): string | undefined {
  const stems = names.map((n) => n.replace(/\.[^./\\]+$/, ""));
  if (stems.length < 2 || stems.some((s) => !s)) return undefined;
  let prefix = stems[0];
  for (const s of stems.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return undefined;
  }
  return prefix.length >= MIN_SUGGESTABLE_PREFIX ? prefix : undefined;
}
