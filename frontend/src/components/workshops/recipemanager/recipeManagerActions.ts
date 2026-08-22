// Recipe Manager panel actions (P1.3 wave 3, Lane D deliverable 3). Plain
// functions over the two live stores (store/plotRecipes.ts's project-scoped
// `plotRecipes`, store/globalPlotRecipes.ts's global `recipes`) rather than a
// React hook -- none of this needs component state, so it is unit-testable
// directly against the real stores, the same "extracted UI-adjacent action
// module" shape components/windows/figureLifecycleUi.ts uses for
// store/plotRecipes.ts's OWN focused-window gesture.
//
// `PlotRecipe` is location-agnostic (lib/plotRecipeStorage.ts's header) --
// `moveRecipeScope` below is the one place that actually moves the OBJECT
// between the two lists; every other action here operates on whichever
// single list `scope` names.

import { dedupeWindowTitle } from "../../../lib/plotview";
import { exportRecipeFile, importRecipeFile } from "../../../lib/plotRecipeStorage";
import type { PlotRecipe } from "../../../lib/plotRecipe";
import { saveBlob } from "../../../lib/download";
import { useApp } from "../../../store/useApp";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";

export type RecipeScope = "project" | "global";

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

/** Move a recipe from `scope` to the OTHER scope, deduping its name against
 *  the destination list (never colliding two rows onto one label there,
 *  same L0.31 rule every other recipe rename/duplicate/save already
 *  follows). No-op for an unknown id. The PROJECT side of the move records
 *  ONE undo entry via the ordinary `recordHistory` + `setPlotRecipes` seam
 *  (`setPlotRecipes` itself is documented as a raw, non-recording replace --
 *  the `recordHistory` call here is what makes THIS particular replace
 *  undoable); the GLOBAL side is not undo-tracked at all, matching every
 *  other action on that store (global scope carries no undo history, by
 *  design -- see store/globalPlotRecipes.ts's header). */
export function moveRecipeScope(scope: RecipeScope, id: string): void {
  if (scope === "project") {
    const state = useApp.getState();
    const recipe = state.plotRecipes.find((r) => r.id === id);
    if (!recipe) return;
    const globalList = useGlobalPlotRecipes.getState().recipes;
    const deduped = dedupeWindowTitle(recipe.name, globalList.map((r) => r.name));
    state.recordHistory("Move Plot Recipe to Global");
    state.setPlotRecipes(state.plotRecipes.filter((r) => r.id !== id));
    useGlobalPlotRecipes.getState().setAll([...globalList, { ...recipe, name: deduped }]);
  } else {
    const globalList = useGlobalPlotRecipes.getState().recipes;
    const recipe = globalList.find((r) => r.id === id);
    if (!recipe) return;
    const state = useApp.getState();
    const deduped = dedupeWindowTitle(recipe.name, state.plotRecipes.map((r) => r.name));
    useGlobalPlotRecipes.getState().setAll(globalList.filter((r) => r.id !== id));
    state.recordHistory("Move Plot Recipe to Project");
    state.setPlotRecipes([...state.plotRecipes, { ...recipe, name: deduped }]);
  }
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

/** Parse+import `text` (a picked file's contents) into `scope`, deduping its
 *  name against that scope's existing list. Throws `importRecipeFile`'s own
 *  message verbatim on malformed input -- the caller surfaces it, this
 *  function does not swallow it (there is no sane default for a file the
 *  user explicitly chose, same contract `importRecipeFile` itself states). */
export function importRecipeToScope(scope: RecipeScope, text: string): void {
  const recipe = importRecipeFile(text);
  if (scope === "project") {
    const state = useApp.getState();
    const deduped = dedupeWindowTitle(recipe.name, state.plotRecipes.map((r) => r.name));
    state.recordHistory("Import Plot Recipe");
    state.setPlotRecipes([...state.plotRecipes, { ...recipe, name: deduped }]);
  } else {
    const list = useGlobalPlotRecipes.getState().recipes;
    const deduped = dedupeWindowTitle(recipe.name, list.map((r) => r.name));
    useGlobalPlotRecipes.getState().setAll([...list, { ...recipe, name: deduped }]);
  }
}
