// Global-scope Plot Recipe cache (P1.3 wave 3, Lane D). A STANDALONE Zustand
// store -- like store/toasts.ts / store/quickPlotWithDialog.ts / store/
// importDatasets.ts's `useImportBatch` -- rather than a field on `AppState`
// (store/useApp.ts). The global recipe list is deliberately NOT project
// state: it does not round-trip through `.dwk` (lib/workspace.ts's
// `WorkspaceDoc` never mentions it), it must survive opening/closing a
// project untouched, and it is not part of the undo/redo history. Folding it
// into `AppState` would cost useApp.ts's tight line-budget ratchet
// (architecture.test.ts's `STORE_PINS`) for zero benefit, AND would invite
// exactly the "field that persists but has no autosave trigger" bug class
// `useWorkspaceAutosave.ts`'s "AutosaveState completeness sweep" test exists
// to catch -- easiest fixed by never putting it where that sweep looks.
//
// `PlotRecipe` is location-agnostic (see lib/plotRecipeStorage.ts's header
// and lib/plotRecipe.ts's `storageScope` note) -- ORCHESTRATOR RULING B
// (code-review findings 2+3) settled the cross-scope transfer primitive as
// COPY-WITH-A-FRESH-ID (`copyIn` below), not move: an earlier "move" (remove
// from one list, add to the other as two separate, differently-undo-tracked
// writes) could lose the recipe entirely if the project-side add was undone
// after the global-side removal had already landed (finding 2), and
// preserved the SAME id across both lists, so two scopes could end up
// holding entries that share an id (finding 3, which `RecipeManagerPanel.tsx`
// also has to defend against in its own rename-target keying). A copy's
// source is NEVER touched -- undoing a copy-to-project just removes the
// tracked copy from the project list, the global original is untouched;
// copy-to-global isn't undo-tracked and doesn't need to be, since nothing
// was ever removed anywhere. A user who wants MOVE semantics deletes the
// source explicitly afterward (the Recipe Manager panel's copy button says
// so in its title text). The Recipe Manager panel is the one place that
// reads both lists side by side and performs the copy
// (recipeManagerActions.ts's `copyRecipeToOtherScope`); this store owns none
// of that cross-store choreography itself, only the global list's own CRUD +
// persistence, mirroring `store/plotRecipes.ts`'s project-scope CRUD shape
// (save/rename/duplicate/delete/copy-in, name collisions DEDUPE rather than
// overwrite -- L0.31's rule extends to this scope too).
//
// HYDRATION: `hydrate()` reads `lib/plotRecipeStorage.ts`'s
// `loadGlobalPlotRecipes()` ONCE (guarded by `hydrated`) -- called from
// App.tsx's boot effects, mirroring `useWorkspaceAutosave.ts`'s "restore
// once on startup" shape but for a completely separate, non-project store.
// Every mutating action below writes through `saveGlobalPlotRecipes`
// synchronously in the same call, so the in-memory `recipes` array and
// localStorage never drift apart.
//
// FINDING 5 (code-review): every mutating action below calls `get().hydrate()`
// as its OWN first statement, before reading `get().recipes` to compute the
// list it will persist. Without this, a mutation that runs before ANY
// hydrate() has landed this session (a race with App.tsx's boot effect, or a
// direct call from a test/entry point that skips it) would read the
// in-memory `[]` default and persist a list built from THAT -- clobbering
// whatever was already in localStorage down to just the one new/changed
// entry. `hydrate()` itself is synchronous (a plain localStorage read) and
// idempotent (guarded by `hydrated`), so calling it unconditionally here
// costs nothing on the common already-hydrated path. `setAll` itself is
// deliberately NOT included in this guard -- its whole contract is "replace
// the list with EXACTLY what the caller computed"; the guard belongs at the
// point a new list gets COMPUTED from `.recipes`, which is every other
// action below (and `hydratedGlobalRecipes()`, the external read every
// OTHER module that needs this list -- store/plotRecipes.ts's
// matchingPlotRecipes/cleanMatchingPlotRecipe, store/importBatchOffers.ts's
// empty-scope check, recipeManagerActions.ts's copy/import -- must call
// instead of touching `.recipes` raw).

import { create } from "zustand";

import type { PlotRecipe } from "../lib/plotRecipe";
import { loadGlobalPlotRecipes, saveGlobalPlotRecipes } from "../lib/plotRecipeStorage";
import { dedupeWindowTitle } from "../lib/plotview";

let _seq = 0;
const nextGlobalRecipeId = (): string => `gpr-${Date.now().toString(36)}-${++_seq}`;

interface GlobalPlotRecipesState {
  recipes: PlotRecipe[];
  hydrated: boolean;
  /** Load from localStorage once; a repeat call after the first is a no-op
   *  (never clobbers an in-session edit with a stale disk read). */
  hydrate: () => void;
  /** Replace the whole list verbatim AND persist it -- the seam every other
   *  action below funnels through. Deliberately does NOT hydrate first (see
   *  the module doc's FINDING 5 note) -- the caller is trusted to have
   *  already computed the complete intended list. */
  setAll: (list: PlotRecipe[]) => void;
  /** No-op for an unknown id or a blank/unchanged name. A name collision
   *  with another GLOBAL recipe DEDUPES (mirrors `renamePlotRecipe`).
   *  Hydrates first (finding 5). */
  rename: (id: string, name: string) => void;
  /** No-op (null) for an unknown id. Returns the copy's id. Hydrates first
   *  (finding 5). */
  duplicate: (id: string) => string | null;
  /** No-op for an unknown id. Hydrates first (finding 5). */
  remove: (id: string) => void;
  /** ORCHESTRATOR RULING B: add an EXTERNAL recipe (e.g. from the project
   *  scope) under a FRESH id -- never the source's own -- with its name
   *  deduped against this scope's own list. The source is never read or
   *  mutated by this action; the caller (recipeManagerActions.ts's
   *  `copyRecipeToOtherScope`) owns finding it and deciding whether to
   *  remove/keep it. Returns the new copy's id. Hydrates first (finding 5). */
  copyIn: (recipe: PlotRecipe) => string;
}

export const useGlobalPlotRecipes = create<GlobalPlotRecipesState>((set, get) => ({
  recipes: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ recipes: loadGlobalPlotRecipes(), hydrated: true });
  },

  setAll: (list) => {
    saveGlobalPlotRecipes(list);
    set({ recipes: list });
  },

  rename: (id, name) => {
    get().hydrate(); // finding 5
    const nm = name.trim();
    if (!nm) return;
    const list = get().recipes;
    const src = list.find((r) => r.id === id);
    if (!src || src.name === nm) return;
    const dedupedName = dedupeWindowTitle(nm, list.filter((r) => r.id !== id).map((r) => r.name));
    const now = new Date().toISOString();
    get().setAll(list.map((r) => (r.id === id ? { ...r, name: dedupedName, modifiedAt: now } : r)));
  },

  duplicate: (id) => {
    get().hydrate(); // finding 5
    const list = get().recipes;
    const src = list.find((r) => r.id === id);
    if (!src) return null;
    const dedupedName = dedupeWindowTitle(`${src.name} copy`, list.map((r) => r.name));
    const now = new Date().toISOString();
    const copy: PlotRecipe = { ...structuredClone(src), id: nextGlobalRecipeId(), name: dedupedName, createdAt: now, modifiedAt: now };
    get().setAll([...list, copy]);
    return copy.id;
  },

  remove: (id) => {
    get().hydrate(); // finding 5
    if (!get().recipes.some((r) => r.id === id)) return;
    get().setAll(get().recipes.filter((r) => r.id !== id));
  },

  copyIn: (recipe) => {
    get().hydrate(); // finding 5
    const list = get().recipes;
    const dedupedName = dedupeWindowTitle(recipe.name, list.map((r) => r.name));
    const now = new Date().toISOString();
    const copy: PlotRecipe = { ...structuredClone(recipe), id: nextGlobalRecipeId(), name: dedupedName, createdAt: now, modifiedAt: now };
    get().setAll([...list, copy]);
    return copy.id;
  },
}));

/** Read the live global list, hydrating first if this is the very first
 *  access this session -- the chokepoint every EXTERNAL consumer (never a
 *  member of this store itself) must call instead of touching `.recipes`
 *  raw, per the module doc's FINDING 5 note. */
export function hydratedGlobalRecipes(): PlotRecipe[] {
  useGlobalPlotRecipes.getState().hydrate();
  return useGlobalPlotRecipes.getState().recipes;
}
