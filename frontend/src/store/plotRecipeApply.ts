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
//
// MATCHING EXTRACTION (P1.3 wave 3, Lane D code-review round): `recipeLibs`/
// `resolvedCandidates` (bottom of this file) also moved here, out of
// plotRecipes.ts, for the SAME reason -- code-review findings 4+6 pushed
// that file back over the 500-line ceiling. Landing them in this ALREADY
// eagerly-shared sibling (rather than a brand new file) avoids adding
// another module-boundary's worth of import/export glue on top of an
// already razor-thin eager budget (MAIN_PLAN #29) -- `recipeLibs()` is the
// ONE place `lib/plotRecipe.ts`'s `captureRecipe` / `lib/plotRecipeMatch.ts`'s
// `resolveRecipe` get loaded from, so plotRecipes.ts's many call sites
// (save/apply/confirm/confirmPartial) and `resolvedCandidates` below share
// the exact same cache, never two competing dynamic-import promises.
//
// `resolvedCandidates` is the shared single-resolve-per-candidate pass
// FINDING 6 (code-review, perf) introduced: `matchingPlotRecipes` and
// `cleanMatchingPlotRecipe` (both still in plotRecipes.ts) derive their
// answers from this ONE function instead of `cleanMatchingPlotRecipe`
// calling `matchingPlotRecipes` (which already resolves every candidate)
// and then resolving its first result AGAIN itself -- the old bug's double
// `resolveRecipe` call per candidate that mattered. FINDING 4 (code-review):
// project-scope (`get().plotRecipes`) AND global-scope
// (`globalPlotRecipes.ts`'s `hydratedGlobalRecipes()`) recipes are both
// candidates -- project checked first, so a legacy entry sharing an id
// across both scopes resolves to the PROJECT copy. `globalPlotRecipes.ts`
// is dynamically imported (never a static top-level import) to keep this
// already-eager module from dragging the otherwise boot-lazy global store
// into the always-loaded graph -- see that module's own doc.

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
import { techniqueOf } from "../lib/techniqueDefaults";
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
    facetKey: mapping.facetKey,
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
  // F4.4: `document.bindings.facetKey` above is a real, live facet arrangement
  // waiting to be rendered, not just inert metadata (`facetKey` is now a
  // bindings-owned `PlotView` field, mirroring `groupKey` -- see
  // `lib/figureDocument.ts`'s `figureDocumentToPlotView`). `focusWindow`
  // hydrates this window's document into the live singleton facade, which
  // `MultiPanelStage.tsx`'s `facetCompositionFromBinding` fallback then turns
  // into an actual small-multiples grid -- closing `store/plotRecipes.ts`'s
  // own documented GAP note for the facet case (spatial/break still open).
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

interface RecipeLibs {
  captureRecipe: typeof import("../lib/plotRecipe").captureRecipe;
  resolveRecipe: typeof import("../lib/plotRecipeMatch").resolveRecipe;
}
let _recipeLibs: Promise<RecipeLibs> | null = null;
/** Load capture/matching only after a recipe action. `plotRecipeSchema.ts`
 *  now supplies workspace parsing's lightweight runtime constant, so the
 *  previous synchronous workspace -> plotRecipeIO -> plotRecipe capture
 *  edge no longer exists and both expensive libraries can remain lazy. */
export function recipeLibs(): Promise<RecipeLibs> {
  if (!_recipeLibs) {
    _recipeLibs = Promise.all([import("../lib/plotRecipe"), import("../lib/plotRecipeMatch")]).then(
      ([capture, match]) => ({ captureRecipe: capture.captureRecipe, resolveRecipe: match.resolveRecipe }),
    );
  }
  return _recipeLibs;
}

interface RecipeCandidate {
  recipe: PlotRecipe;
  resolution: Extract<RecipeResolution, { resolved: ResolvedRecipeApplication }>;
}

/** Every recipe scoped to `dataset`'s technique, from BOTH scopes, resolved
 *  EXACTLY ONCE each -- see the module doc's FINDING 4/6 note. `"generic"`
 *  never matches anything (the recipe module's own stronger-than-memory
 *  rule) -- always `[]`. Refused candidates (technique mismatch / errorRole
 *  guard) are dropped, never counted. */
export async function resolvedCandidates(get: SliceGet, dataset: Dataset): Promise<RecipeCandidate[]> {
  const technique = techniqueOf(dataset);
  if (technique === "generic") return [];
  const { hydratedGlobalRecipes } = await import("./globalPlotRecipes");
  const seen = new Set<string>();
  const pool: PlotRecipe[] = [];
  for (const recipe of [...get().plotRecipes, ...hydratedGlobalRecipes()]) {
    if (recipe.technique !== technique || seen.has(recipe.id)) continue;
    seen.add(recipe.id);
    pool.push(recipe);
  }
  if (pool.length === 0) return [];
  const { resolveRecipe } = await recipeLibs();
  const out: RecipeCandidate[] = [];
  for (const recipe of pool) {
    const resolution = resolveRecipe(recipe, dataset);
    if ("refused" in resolution) continue;
    out.push({ recipe, resolution });
  }
  return out;
}
