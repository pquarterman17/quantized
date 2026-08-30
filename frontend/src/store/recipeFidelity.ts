// Whether the WORKSPACE-backed recipe lists in this store were loaded whole
// (P3.5). A one-field slice, and deliberately its own file: the flag covers
// BOTH `plotRecipes` (store/plotRecipes.ts) and `quickPlotTemplates`
// (store/quickPlotTemplates.ts), so it belongs to neither of them, and the
// convention here is to extract a cohesive sibling rather than wedge a field
// into whichever slice happens to have slack (the same reasoning
// store/plotRecipes.ts's own header gives for existing).
//
// WHY IT IS STORE STATE AND NOT A MODULE SINGLETON. An earlier attempt at
// this used `export const recipeFidelity = { complete: true }`. Review killed
// it for three reasons worth keeping written down, because they are the
// reasons this file exists:
//
//   1. A plain module object has no React subscription, so a panel reading it
//      only re-renders when something ELSE it subscribes to happens to change
//      in the same tick. Correct by luck.
//   2. Fidelity was ASSIGNED at one call site rather than DERIVED from the
//      state it describes, so every present and future load/merge path had to
//      remember to update it — and one of them already didn't.
//   3. It outlived a `beforeEach` store reset, so tests leaked into each
//      other.
//
// As a store field it moves with the lists it describes, resets with them,
// and is subscribable.
//
// NOT UNDOABLE (HISTORY_EXCLUDED in architecture.test.ts): it is derived at
// load and never user-edited, so there is nothing to undo TO. Restoring a
// stale `true` over a genuine `false` would re-certify sources the load
// actually lost — the exact failure the flag exists to prevent.
//
// NOT PERSISTED: `serializeWorkspace` builds its document by picking fields
// explicitly and this is not among them, so it cannot round-trip into a saved
// project. It is re-derived by `parseWorkspace` on every open.

export interface RecipeFidelitySlice {
  /** False when the open project's `plotRecipes` or `quickPlotTemplates` field
   *  was present but unreadable, or had records dropped by its sanitizer.
   *
   *  True on a fresh session: an empty app has lost nothing. Consumers must
   *  combine it with the OTHER recipe systems' own signals — see
   *  `lib/recipeSources.ts`'s `collectRecipes`, which will not let sidecar
   *  favorites/tags be pruned against a collection any source doubts. */
  recipeSourcesComplete: boolean;
}

/** State only, no action: the single write site is `useApp.loadWorkspace`'s
 *  own `set()`, which restores this field alongside the two lists it
 *  describes. A setter here would have no caller. */
export function createRecipeFidelitySlice(): RecipeFidelitySlice {
  return { recipeSourcesComplete: true };
}
