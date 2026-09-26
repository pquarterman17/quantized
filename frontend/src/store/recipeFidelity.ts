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
   *  Read it through `recipeSourcesWhole`, which also counts the carry.
   *
   *  True on a fresh session: an empty app has lost nothing. Consumers must
   *  combine it with the OTHER recipe systems' own signals — see
   *  `lib/recipeSources.ts`'s `collectRecipes`, which will not let sidecar
   *  favorites/tags be pruned against a collection any source doubts. */
  recipeSourcesComplete: boolean;
  /** P2.7 follow-up: the saved fit-model records the open project(s) carried
   *  that the local library does not hold — ones this build cannot read (a
   *  newer version, a damaged entry) and ones the library refused (storage
   *  full, a damaged slot). Never shown or edited — only written back into
   *  the `.dwk` on the next save (lib/fitModelsProject.ts), so opening a
   *  project in an older build and saving it does not destroy a newer build's
   *  models. Replaced by a load, grown by an append and by a refused merge. A
   *  non-empty carry makes `recipeSourcesWhole` false — DERIVED, never
   *  assigned, so undo cannot desync the two. UNDOABLE, unlike the flag (it
   *  is in HistorySnapshot): it is project content that travels with the
   *  datasets. PERSISTED and AUTOSAVED, unlike the flag: `serializeWorkspace`
   *  reads it from the state it is given, and useWorkspaceAutosave's
   *  `shouldAutosave` tracks it. */
  fitModelCarry: unknown[];
}

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

// Which carries are the SAME project's, grown: an append and a refused merge
// grow the carry (`grownCarry`), while a load, "remove all" and an undo
// REPLACE it. The async merge (store/workspaceHydration.ts's
// `adoptFitModels`) writes its refused records only into a carry that grew
// from the one it started with — never into another project's (PR #432
// review: comparing identity alone lost them when a second append landed
// first). Each grown array remembers the array its lineage began with.
const carryRoots = new WeakMap<unknown[], unknown[]>();
const rootOf = (carry: unknown[]): unknown[] => carryRoots.get(carry) ?? carry;

/** `carry` with `more` appended — the same project's carry, grown. */
export function grownCarry(carry: unknown[], more: readonly unknown[]): unknown[] {
  const next = [...carry, ...more];
  carryRoots.set(next, rootOf(carry));
  return next;
}

/** Is `current` the carry `expected` was, or grown from it — not a load's,
 *  a "remove all"'s or an undo's replacement? */
export function carryGrewFrom(current: unknown[], expected: unknown[]): boolean {
  if (current === expected) return true;
  return (
    rootOf(current) === rootOf(expected) &&
    current.length >= expected.length &&
    expected.every((r, i) => current[i] === r)
  );
}

/** State only, no action: the write sites are `loadWorkspace` (replace) and
 *  `appendWorkspace` (grow), store/workspaceHydration.ts, and the refused
 *  merge they start (its `adoptFitModels`). A setter here would have no
 *  caller. */
export function createRecipeFidelitySlice(): RecipeFidelitySlice {
  return { recipeSourcesComplete: true, fitModelCarry: [] };
}
