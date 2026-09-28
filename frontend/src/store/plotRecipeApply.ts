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
// that file back over the 500-line ceiling. Landing them in this sibling
// (rather than a brand new file) avoids adding another module-boundary's
// worth of import/export glue -- `recipeLibs()` is the ONE place
// `lib/plotRecipe.ts`'s `captureRecipe` / `lib/plotRecipeMatch.ts`'s
// `resolveRecipe` get loaded from, so plotRecipes.ts's many call sites
// (save/apply/confirm/confirmPartial) and `resolvedCandidates` below share
// the exact same cache, never two competing dynamic-import promises.
// (STALE-DOC FIX, finding 9: this paragraph originally called this module
// "already eagerly-shared" -- true when it was first split out of the
// then-eager plotRecipes.ts, false since the 2026-09-18 bundle-diet slice
// made THIS module itself a lazy SEAM, loaded on demand via
// `store/plotRecipeApplyLazy.ts` -- see `architecture.test.ts`'s SEAMS list.)
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
// is dynamically imported (never a static top-level import) so loading
// THIS module's own lazy chunk doesn't also drag the otherwise-independent
// global store's state/persistence machinery along with it on every apply
// -- only `resolvedCandidates` (and, since the review round, the "recently
// used" scope lookup in `applyResolvedRecipe` below) actually needs it.

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
import { nextRefLineId } from "./plotViewSettings";
import { recordRecipeUse } from "./recordRecipeUse";
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
    // FINDING 4 (code-review): every incoming refLine is RE-MINTED a fresh id
    // from `store/plotViewSettings.ts`'s own `nextRefLineId()` -- the SAME
    // counter `addRefLine` draws from -- rather than keeping whatever id the
    // recipe happened to capture. A captured project/global recipe's
    // refLines carry "ref-N" ids minted by a PAST session's `_refSeq`; that
    // counter restarts at 0 every session, so applying such a recipe and
    // then clicking "add reference line" in the SAME (fresh) session could
    // mint the identical "ref-1" a second time -- two lines sharing one id,
    // which `removeRefLine`/`updateRefLine` (both keyed by id) can no longer
    // tell apart. Reminting here closes that off structurally: every applied
    // line and every later `addRefLine` call draw from the one counter, so
    // two ids can never coincide within a session.
    refLines: visual.refLines.map((r) => ({ ...r, id: nextRefLineId() })),
  };
}

/** The apply gesture's entire body, shared by the clean-match path and both
 *  confirm actions -- ONE `recordHistory` call (inside `createWindow`),
 *  everything else rides the same undo unit. Fails closed (false, a status
 *  message, no history entry, no new window/figure) if the dataset vanished
 *  between resolve and apply -- and, since finding 4's confirm re-resolve
 *  fix, `resolved` here is always freshly computed against the CURRENT
 *  dataset (never a stale stage-time one), so a column removed/reordered/
 *  recoded mid-gesture can't sneak a stale index in.
 *
 *  Async since the review round (FINDING 6, code-review): the "recently
 *  used" scope lookup below now needs `globalPlotRecipes.ts`'s hydrated
 *  list, loaded the same dynamic-import way `resolvedCandidates` already
 *  does. Every existing caller was already inside an `async` function
 *  awaiting this file's OWN `recipeLibs()` first (see the module doc), so no
 *  call site's shape changes except `store/plotRecipes.ts`'s
 *  `confirmPendingRecipeApplicationPartial`, which reads the returned
 *  boolean synchronously and now awaits it explicitly. */
export async function applyResolvedRecipe(
  set: SliceSet,
  get: SliceGet,
  recipe: PlotRecipe,
  datasetId: string,
  resolved: ResolvedRecipeApplication,
): Promise<boolean> {
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
  // own documented GAP note for the facet case. BUG-012 closed the BREAK case
  // the same way: `axisBreaks` above rides the document's canonical
  // `plot.axisBreaks.x`, which `lib/facet.durableComposition` (the other half
  // of that same fallback) rebuilds into paneled x-breaks once this window is
  // focused -- see store/plotRecipes.test.ts's "applyPlotRecipe rebuilds a
  // live paneled x-break" for the end-to-end pin. SPATIAL is still open.
  get().focusWindow(windowId);
  // P3.5 "recently used". This is the ONE commit seam every plot-recipe apply
  // entry point funnels through (`resolveApplyOrStage`'s clean-match branch
  // and both confirm paths — see this file's header), so recording here counts
  // each apply exactly once and cannot miss a route. Deliberately AFTER the
  // early `return false` above: staging, refusing, or losing the dataset is
  // not a use.
  //
  // FINDING 6 (code-review): scope is now decided by ACTUAL LIST MEMBERSHIP,
  // never an `isBuiltinPlotRecipeId` id-prefix check. The old code skipped
  // recording only for an id starting with the built-in `"builtin:"` prefix
  // and otherwise blindly recorded PROJECT-or-GLOBAL by a truthiness check --
  // two ways that went wrong: (a) a genuine user-saved recipe whose id
  // happens to start with `"builtin:"` (nothing stops a `.qzrecipe.json`
  // import from carrying one) was silently skipped even though it lives in
  // a real list; (b) a project recipe DELETED between staging and this
  // confirm no longer lives in `state.plotRecipes` at all, yet the old
  // ternary's `false` branch recorded it as "global" anyway -- a phantom
  // sidecar row for a recipe that no longer exists in that scope. Checking
  // BOTH real lists directly (project first, matching `applyPlotRecipe`'s
  // own lookup order) and recording nothing when the id is in neither closes
  // both: a built-in (member of neither list, by construction -- see
  // `lib/builtinPlotRecipes.ts`'s own module doc) still records nothing, but
  // now because it genuinely isn't anywhere, not because of its id's
  // spelling.
  const inProject = get().plotRecipes.some((r) => r.id === recipe.id);
  const inGlobal = inProject
    ? false
    : (await import("./globalPlotRecipes")).hydratedGlobalRecipes().some((r) => r.id === recipe.id);
  if (inProject || inGlobal) {
    recordRecipeUse({ kind: "plot", scope: inProject ? "project" : "global", id: recipe.id });
  }
  return true;
}

/** Resolve `recipe` against `datasetId`'s live dataset and either apply
 *  immediately (a clean match), stage a `pendingRecipeApplication` (some
 *  fields unmatched -- zero mutation until confirmed), or refuse (zero
 *  mutation, a status message). `resolveRecipe` is passed in rather than
 *  imported directly so this module never value-imports `lib/plotRecipeMatch.ts`
 *  itself -- the caller has ALREADY paid its lazy-load cost via
 *  plotRecipes.ts's `recipeLibs()` (see that module's LAZY-LOADED note); a
 *  static import here would silently re-eagerize it. Async (Promise<boolean>)
 *  since `applyResolvedRecipe` itself became async (finding 6) -- every
 *  caller was already `async` and awaiting this same file's `recipeLibs()`
 *  first, so no call site's shape changes. */
export async function resolveApplyOrStage(
  set: SliceSet,
  get: SliceGet,
  recipe: PlotRecipe,
  datasetId: string,
  resolveRecipe: (recipe: PlotRecipe, dataset: Dataset) => RecipeResolution,
): Promise<boolean> {
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
  _recipeLibs ??= Promise.all([import("../lib/plotRecipe"), import("../lib/plotRecipeMatch")])
    .then(([capture, match]) => ({ captureRecipe: capture.captureRecipe, resolveRecipe: match.resolveRecipe }))
    .catch((e: unknown) => {
      // Not cached on failure: drop the slot so the next gesture retries
      // rather than replaying one transient fetch failure for the rest of
      // the session (same pattern as `plotRecipeApplyLazy.ts`'s `inflight`).
      _recipeLibs = null;
      throw e;
    });
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
 *  guard) are dropped, never counted. A recipe flagged `noAutoSuggest`
 *  (code-review finding 7 -- a "Copy to Project" of a built-in) is dropped
 *  here too, BEFORE it is ever resolved: this is the ONE function both
 *  `matchingPlotRecipes`'s suggestion list and `cleanMatchingPlotRecipe`'s
 *  post-import toast read from, so excluding it here closes the surface for
 *  both at once. The flag never affects a DIRECT apply by id/object
 *  (`applyPlotRecipe`/`applyPlotRecipeObject`, which never call this
 *  function) -- a flagged copy still applies manually like any other
 *  project/global recipe. */
export async function resolvedCandidates(get: SliceGet, dataset: Dataset): Promise<RecipeCandidate[]> {
  const technique = techniqueOf(dataset);
  if (technique === "generic") return [];
  const { hydratedGlobalRecipes } = await import("./globalPlotRecipes");
  const seen = new Set<string>();
  const pool: PlotRecipe[] = [];
  for (const recipe of [...get().plotRecipes, ...hydratedGlobalRecipes()]) {
    if (recipe.technique !== technique || recipe.noAutoSuggest || seen.has(recipe.id)) continue;
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
