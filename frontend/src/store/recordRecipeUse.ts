// P3.5 — record that a saved recipe was actually applied, from the EAGER apply
// paths, without dragging the sidecar index into the entry chunk.
//
// `lib/recipeIndex.ts` is only ever needed after a user action, but the two
// store apply paths that must report a use (`plotRecipeApply.applyResolvedRecipe`
// and `quickPlotTemplates.applyQuickPlotTemplate`) live in eagerly-composed
// slices. A static import there would make the index, and its localStorage
// read/sanitize/trim machinery, part of first paint for the sake of a
// bookkeeping write. Hence the dynamic import — the same reasoning
// `store/plotRecipes.ts`'s `recipeLibs()` gives for the capture/match modules.
//
// The type import is erased at build time, so this module has NO eager runtime
// dependency of its own.
//
// FIRE AND FORGET, DELIBERATELY. Recording a use is bookkeeping that no caller
// waits on and no user asked for: making an apply async, or failing one,
// because a recency counter could not be written would be the tail wagging the
// dog. `recipeIndex`'s own writer already degrades quietly under quota
// pressure (it sheds recents before favorites), so the only errors reaching
// the catch here are a failed chunk fetch or an unavailable localStorage —
// both of which cost the user nothing but a missing "recently used" row.

import type { RecipeRef } from "../lib/recipeLibrary";

export function recordRecipeUse(ref: RecipeRef): void {
  void import("../lib/recipeIndex")
    .then((m) => {
      m.recordUse(ref);
    })
    .catch(() => {
      /* see FIRE AND FORGET above — a missing recency row is not worth a toast */
    });
}
