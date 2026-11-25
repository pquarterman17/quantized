// The lazy-only half of recipeFidelity.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the whole-recipe source reader. Only lazy modules call it.
// The code moved here verbatim and recipeFidelity.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import type { RecipeFidelitySlice } from "./recipeFidelity";

/** Are EVERY workspace-backed recipe source whole — the lists the load
 *  judged (`recipeSourcesComplete`) AND no carried fit models? The one
 *  reader of the verdict (the Recipe Library panel). Derived from the carry
 *  on every read rather than folded into the flag at load: the carry is
 *  undoable and the flag is not, so a stored combination would disagree
 *  with the carry after an undo (undoing "remove all" brings the carry back,
 *  but not a `false`). */
export function recipeSourcesWhole(s: RecipeFidelitySlice): boolean {
  return s.recipeSourcesComplete && s.fitModelCarry.length === 0;
}
