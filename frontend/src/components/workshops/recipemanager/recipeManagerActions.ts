// Recipe Manager panel actions (P1.3 wave 3, Lane D deliverable 3). Plain
// functions over the two live stores (store/plotRecipes.ts's project-scoped
// `plotRecipes`, store/globalPlotRecipes.ts's global `recipes`) rather than a
// React hook -- none of this needs component state, so it is unit-testable
// directly against the real stores, the same "extracted UI-adjacent action
// module" shape components/windows/figureLifecycleUi.ts uses for
// store/plotRecipes.ts's OWN focused-window gesture.
//
// `PlotRecipe` is location-agnostic (lib/plotRecipeStorage.ts's header) --
// `copyRecipeToOtherScope` below is the one place that actually copies the
// OBJECT between the two lists (ORCHESTRATOR RULING B, code-review findings
// 2+3 -- see store/globalPlotRecipes.ts's module doc for the full "why copy,
// not move" rationale); every other action here operates on whichever single
// list `scope` names.

import { exportRecipeFile, importRecipeFile } from "../../../lib/plotRecipeStorage";
import type { PlotRecipe } from "../../../lib/plotRecipe";
import { saveBlob } from "../../../lib/download";
import { hydratedGlobalRecipes, useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useApp } from "../../../store/useApp";

// Re-exported, not redeclared: storage scope is a domain fact (see
// lib/recipeLibrary.ts, which the unified Recipe Library also builds on), and
// two copies of the same union is how the Library and this panel would
// eventually disagree about what "global" means. Type-only, so it costs
// nothing at runtime.
import type { RecipeScope } from "../../../lib/recipeLibrary";

export type { RecipeScope };

export interface RecipeRow {
  scope: RecipeScope;
  recipe: PlotRecipe;
}

/** Every recipe across BOTH scopes, project first -- the manager panel's one
 *  read. Pure (a snapshot of whatever the two stores hold right now); the
 *  panel re-derives this on every render via its own store subscriptions,
 *  this function just does the concatenation + tagging. */
export function combinedRecipeRows(project: readonly PlotRecipe[], global: readonly PlotRecipe[]): RecipeRow[] {
  return [
    ...project.map((recipe) => ({ scope: "project" as const, recipe })),
    ...global.map((recipe) => ({ scope: "global" as const, recipe })),
  ];
}

export function renameRecipe(scope: RecipeScope, id: string, name: string): void {
  if (scope === "project") useApp.getState().renamePlotRecipe(id, name);
  else useGlobalPlotRecipes.getState().rename(id, name);
}

export function duplicateRecipe(scope: RecipeScope, id: string): string | null {
  return scope === "project" ? useApp.getState().duplicatePlotRecipe(id) : useGlobalPlotRecipes.getState().duplicate(id);
}

export function deleteRecipe(scope: RecipeScope, id: string): void {
  if (scope === "project") useApp.getState().deletePlotRecipe(id);
  else useGlobalPlotRecipes.getState().remove(id);
}

/** ORCHESTRATOR RULING B (code-review findings 2+3): copy `id` (found in
 *  `scope`) into the OTHER scope under a FRESH id (never the source's own --
 *  closes finding 3's dual-id cause) with its name deduped against the
 *  destination list (never colliding two rows onto one label there, same
 *  L0.31 rule every other recipe rename/duplicate/save already follows).
 *  The SOURCE is NEVER touched -- no removal, no source-side mutation of any
 *  kind -- which is what closes finding 2's undo-data-loss bug: there is no
 *  source-side write for an undo to ever lose track of. Copy-to-project
 *  records ONE undoable history entry (`copyPlotRecipeIn`); undoing it
 *  removes ONLY the tracked copy. Copy-to-global is not undo-tracked, same
 *  as every other action on that store (global scope carries no undo
 *  history, by design -- see store/globalPlotRecipes.ts's header) -- and
 *  needs none, since nothing was ever removed anywhere. A user who wants
 *  MOVE semantics deletes the source afterward (the Recipe Manager panel's
 *  copy button says so in its own title text). No-op (null) for an unknown
 *  id. Returns the new copy's id. */
export function copyRecipeToOtherScope(scope: RecipeScope, id: string): string | null {
  if (scope === "project") {
    const recipe = useApp.getState().plotRecipes.find((r) => r.id === id);
    if (!recipe) return null;
    return useGlobalPlotRecipes.getState().copyIn(recipe);
  }
  const recipe = hydratedGlobalRecipes().find((r) => r.id === id);
  if (!recipe) return null;
  return useApp.getState().copyPlotRecipeIn(recipe);
}

/** Apply a recipe (either scope) to `datasetId` -- routes through the ONE
 *  canonical apply path (`applyPlotRecipeObject`, store/plotRecipes.ts) that
 *  never depends on `recipe` being a member of the project list. */
export function applyRecipeToDataset(recipe: PlotRecipe, datasetId: string): Promise<boolean> {
  return useApp.getState().applyPlotRecipeObject(recipe, datasetId);
}

/** Trigger a browser download of `recipe` as a standalone `.json` file. */
export function exportRecipe(recipe: PlotRecipe): void {
  saveBlob(
    new Blob([exportRecipeFile(recipe)], { type: "application/json" }),
    `${recipe.name.replace(/[^A-Za-z0-9._-]/g, "_")}.qzrecipe.json`,
  );
}

/** Parse+import `text` (a picked file's contents) into `scope`, returning the
 *  LANDED recipe's id. Throws `importRecipeFile`'s own message verbatim on
 *  malformed input -- the caller surfaces it, this function does not swallow
 *  it (there is no sane default for a file the user explicitly chose, same
 *  contract `importRecipeFile` itself states). Delegates the actual
 *  insertion to each scope's own copy-in action (`copyPlotRecipeIn`/
 *  `copyIn`) -- the SAME fresh-id + deduped-name + (for global) hydrate-first
 *  guard (finding 5) `copyRecipeToOtherScope` uses, rather than a third
 *  hand-rolled insertion with its own chance to drift. `importRecipeFile`
 *  already mints its own fresh id; minting a SECOND one here (P3.5: this is
 *  the id the caller gets back, so a library-level import can focus the new
 *  row) is harmless -- still unique -- and keeps this a plain,
 *  un-special-cased call into the shared seam. */
export function importRecipeToScope(scope: RecipeScope, text: string): string {
  const recipe = importRecipeFile(text); // throws on malformed
  return scope === "project" ? useApp.getState().copyPlotRecipeIn(recipe) : useGlobalPlotRecipes.getState().copyIn(recipe);
}
