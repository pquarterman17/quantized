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
// and lib/plotRecipe.ts's `storageScope` note) -- moving a recipe between
// project and global scope is moving the OBJECT between `store/plotRecipes.ts`'s
// `plotRecipes` list and this store's `recipes` list, never a field flip. The
// Recipe Manager panel is the one place that reads both lists side by side
// and performs that move (RecipeManagerPanel.tsx); this store owns none of
// that cross-store choreography itself, only the global list's own CRUD +
// persistence, mirroring `store/plotRecipes.ts`'s project-scope CRUD shape
// (save/rename/duplicate/delete, name collisions DEDUPE rather than
// overwrite -- L0.31's rule extends to this scope too).
//
// HYDRATION: `hydrate()` reads `lib/plotRecipeStorage.ts`'s
// `loadGlobalPlotRecipes()` ONCE (guarded by `hydrated`) -- called from
// App.tsx's boot effects, mirroring `useWorkspaceAutosave.ts`'s "restore
// once on startup" shape but for a completely separate, non-project store.
// Every mutating action below writes through `saveGlobalPlotRecipes`
// synchronously in the same call, so the in-memory `recipes` array and
// localStorage never drift apart.

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
   *  action below funnels through, and the one a cross-store "move to
   *  global" gesture (RecipeManagerPanel.tsx) calls directly. */
  setAll: (list: PlotRecipe[]) => void;
  /** No-op for an unknown id or a blank/unchanged name. A name collision
   *  with another GLOBAL recipe DEDUPES (mirrors `renamePlotRecipe`). */
  rename: (id: string, name: string) => void;
  /** No-op (null) for an unknown id. Returns the copy's id. */
  duplicate: (id: string) => string | null;
  /** No-op for an unknown id. */
  remove: (id: string) => void;
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
    if (!get().recipes.some((r) => r.id === id)) return;
    get().setAll(get().recipes.filter((r) => r.id !== id));
  },
}));
