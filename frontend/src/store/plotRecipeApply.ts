// Apply-path internals for store/plotRecipes.ts (P1.3 wave 3, Lane D headroom
// extraction) -- moved out verbatim (behavior unchanged) to keep that file
// under the 500-line general .ts ceiling (architecture.test.ts) after adding
// `confirmPendingRecipeApplicationPartial` + the two small manager-panel/
// suggestion-toast seams (`applyPlotRecipeObject`, `cleanMatchingPlotRecipe`).
// Same "extract a cohesive sibling instead of raising the pin" convention
// this file's own module doc's LAZY-LOADED note and the ratchet's own history
// comments (see architecture.test.ts's MODULE_PINS) already establish.
//
// `resolveApplyOrStage` is the ONE seam every apply entry point shares:
// `applyPlotRecipe` (plotRecipes.ts, looks a recipe up by id in
// `state.plotRecipes` -- project scope only) and `applyPlotRecipeObject`
// (plotRecipes.ts, takes a `PlotRecipe` object directly -- the Recipe
// Manager panel's "apply a GLOBAL-scope recipe" gesture needs this, since a
// global recipe is never a member of `state.plotRecipes`) both resolve then
// branch apply-immediately / stage-pending / refuse the identical way. Pulled
// out of `applyPlotRecipe`'s body verbatim rather than re-derived, so the two
// callers can never silently diverge on that branching.
//
// `viewFromResolved` + `applyResolvedRecipe` are `confirmPendingRecipeApplication`'s
// and `confirmPendingRecipeApplicationPartial`'s shared "commit a resolved
// application" body too -- see plotRecipes.ts's own module doc's APPLY PATH
// section for the full contract (one recordHistory call inside createWindow,
// fails closed if the dataset vanished, never trusts a stale resolution).

import { errKeysFromBindings } from "../lib/errorRoles";
import { createFigureDocument } from "../lib/figureDocument";
import type { PlotRecipe } from "../lib/plotRecipe";
import type {
  RecipeResolution,
  ResolvedRecipeApplication,
  ResolvedRecipeMapping,
  ResolvedRecipeVisual,
} from "../lib/plotRecipeMatch";
import { dedupeWindowTitle, defaultPlotView, type PlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";
import { nextFigureId } from "./figureLifecycle";
import { withPlotWindowDocument } from "./windowDocuments";

export type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
export type SliceGet = () => AppState;

/** Re-key a resolved recipe's mapping+visual into a fresh `PlotView` seed --
 *  the same "start from `defaultPlotView()`, overlay only what the source
 *  actually specifies" shape `lib/quickFigureCommit.ts`'s `quickFigureCommit`
 *  uses. `errKeys` is the legacy symmetric-Y projection (the rich `errors`
 *  travel separately into the document via `createFigureDocument`'s own
 *  `errors` input, same split `createFigureDocument` itself makes). */
export function viewFromResolved(mapping: ResolvedRecipeMapping, visual: ResolvedRecipeVisual): PlotView {
  return {
    ...defaultPlotView(),
    xKey: mapping.xKey,
    yKeys: mapping.yKeys,
    y2Keys: mapping.y2Keys,
    groupKey: mapping.groupKey,
    errKeys: errKeysFromBindings(mapping.errors),
    xScale: visual.xScale,
    yScale: visual.yScale,
    y2Scale: visual.y2Scale,
    xLim: visual.xRange.mode === "fixed" ? visual.xRange.lim : null,
    xStep: visual.xRange.mode === "fixed" ? (visual.xRange.step ?? null) : null,
    yLim: visual.yRange.mode === "fixed" ? visual.yRange.lim : null,
    yStep: visual.yRange.mode === "fixed" ? (visual.yRange.step ?? null) : null,
    y2Lim: visual.y2Range.mode === "fixed" ? visual.y2Range.lim : null,
    y2Step: visual.y2Range.mode === "fixed" ? (visual.y2Range.step ?? null) : null,
    xFmt: visual.xFmt,
    yFmt: visual.yFmt,
    y2Fmt: visual.y2Fmt,
    showLegend: visual.showLegend,
    legendPos: visual.legendPos,
    legendXY: visual.legendXY,
    legendTitle: visual.legendTitle,
    legendStatic: visual.legendStatic,
    stackMode: visual.stackMode,
    waterfall: visual.waterfall,
    plotTemplate: visual.plotTemplate,
    seriesStyles: visual.seriesStyles,
    seriesLabels: visual.seriesLabels,
    seriesOrder: visual.seriesOrder,
    hiddenChannels: visual.hiddenChannels,
    annotations: visual.decorations.annotations,
    shapes: visual.decorations.shapes,
    regionShades: visual.decorations.regionShades,
  };
}

/** The apply gesture's entire body, shared by the clean-match path and both
 *  confirm actions -- ONE `recordHistory` call (inside `createWindow`),
 *  everything else rides the same undo unit. Fails closed (false, a status
 *  message, no history entry, no new window/figure) if the dataset vanished
 *  between resolve and apply -- and, since finding 4's confirm re-resolve
 *  fix, `resolved` here is always freshly computed against the CURRENT
 *  dataset (never a stale stage-time one), so a column removed/reordered/
 *  recoded mid-gesture can't sneak a stale index in. */
export function applyResolvedRecipe(
  set: SliceSet,
  get: SliceGet,
  recipe: PlotRecipe,
  datasetId: string,
  resolved: ResolvedRecipeApplication,
): boolean {
  const state = get();
  const dataset = state.datasets.find((d) => d.id === datasetId);
  if (!dataset) {
    set({ status: `Plot Recipe "${recipe.name}" unavailable: dataset not found` });
    return false;
  }
  const seedView = viewFromResolved(resolved.mapping, resolved.visual);
  // Item 10's dedupe convention, against the Library's figure names (the
  // same set `createQuickFigureFromMapping` dedupes its own title against).
  const name = dedupeWindowTitle(recipe.name, state.editableFigures.map((f) => f.name));
  const windowId = state.createWindow(dataset.id, seedView, name); // the gesture's ONE recordHistory
  const id = nextFigureId();
  const document = createFigureDocument({
    id,
    name,
    datasetId: dataset.id,
    view: seedView,
    mark: resolved.visual.mark,
    groupKey: resolved.mapping.groupKey,
    facetKey: resolved.mapping.facetKey,
    errors: resolved.mapping.errors,
    axisBreaks: resolved.visual.axisBreaks,
  });
  set((current) => ({
    editableFigures: [...current.editableFigures, document],
    // The declared FigureDocument write chokepoint -- never a raw
    // `{ ...w, document }` here (architecture.test.ts's F1 guard).
    plotWindows: current.plotWindows.map((w) => (w.id === windowId ? withPlotWindowDocument(w, document) : w)),
    status: `applied plot recipe "${recipe.name}"`,
  }));
  get().focusWindow(windowId);
  return true;
}

/** Resolve `recipe` against `datasetId`'s live dataset and either apply
 *  immediately (a clean match), stage a `pendingRecipeApplication` (some
 *  fields unmatched -- zero mutation until confirmed), or refuse (zero
 *  mutation, a status message). `resolveRecipe` is passed in rather than
 *  imported directly so this module never value-imports `lib/plotRecipeMatch.ts`
 *  itself -- the caller has ALREADY paid its lazy-load cost via
 *  plotRecipes.ts's `recipeLibs()` (see that module's LAZY-LOADED note); a
 *  static import here would silently re-eagerize it. */
export function resolveApplyOrStage(
  set: SliceSet,
  get: SliceGet,
  recipe: PlotRecipe,
  datasetId: string,
  resolveRecipe: (recipe: PlotRecipe, dataset: Dataset) => RecipeResolution,
): boolean {
  const state = get();
  const dataset = state.datasets.find((d) => d.id === datasetId);
  if (!dataset) {
    set({ status: `Plot Recipe "${recipe.name}" unavailable: dataset not found` });
    return false;
  }
  const resolution = resolveRecipe(recipe, dataset);
  if ("refused" in resolution) {
    set({ status: `Plot Recipe "${recipe.name}" unavailable: ${resolution.refused}` });
    return false;
  }
  if (resolution.unmatched.length > 0) {
    set({ pendingRecipeApplication: { recipe, datasetId, resolution } });
    return false;
  }
  return applyResolvedRecipe(set, get, recipe, datasetId, resolution.resolved);
}
