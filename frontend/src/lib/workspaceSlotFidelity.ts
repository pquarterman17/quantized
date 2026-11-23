// Did one .dwk recipe array survive its sanitizer intact? Moved verbatim out
// of ./workspace.ts (its only caller, parseWorkspace) under that file's
// 500-line ceiling, to fund the window-layout key (WORKSPACE_LAYOUT_PLAN P0).

/** Did one .dwk recipe array survive its sanitizer intact?
 *
 *  Mirrors `lib/recipeSources.ts`'s `slotComplete` deliberately, because the
 *  Recipe Library combines both answers into one `complete` flag and they have
 *  to mean the same thing: an ABSENT field is a whole (empty) source; a
 *  non-array is a source we could not read; and an array the sanitizer
 *  SHORTENED is the dangerous case — those records still exist in the file,
 *  so a consumer pruning sidecar metadata against the loaded list would delete
 *  the favorites and tags of recipes that are merely missing from THIS read.
 *
 *  ABSENT means `undefined` — the key is not in the document — and ONLY that.
 *  An explicit `null` is present, is not an array, and so is a shape we did
 *  not understand. Getting this wrong is easy because `slotComplete` appears
 *  to accept null: its `raw === null` is `localStorage.getItem` reporting the
 *  key ABSENT, whereas a STORED JSON `null` parses to `null` there and fails
 *  the same `Array.isArray` check this one does. No real save can produce it
 *  either way — `serializeWorkspace` writes `?? []` for both fields — so a
 *  `null` here came from a hand-edited or truncated file, which is precisely
 *  when certifying completeness is destructive.
 *
 *  `loaded` must be the sanitize output's length, never a later filtered one:
 *  see the two-step quick-plot-template call in `parseWorkspace`. */
export function slotFidelity(raw: unknown, loaded: number): boolean {
  if (raw === undefined) return true;
  if (!Array.isArray(raw)) return false; // null included — present, wrong shape
  return raw.length === loaded;
}
