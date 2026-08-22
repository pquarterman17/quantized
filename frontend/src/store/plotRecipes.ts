// Plot recipe CRUD + apply (P1.3 wave 2, Lane B). A sibling slice file rather
// than another method on WindowsSlice/QuickFigureCreateSlice -- the same
// "extract a cohesive sibling instead of raising the pin" convention
// store/quickPlotTemplates.ts, store/datasetMeta.ts, and store/cellEdit.ts
// already follow (useApp.ts has no slack to spend on a second CRUD block).
//
// Builds directly on wave 1's frozen pure library API:
//   - `lib/plotRecipe.ts`'s `captureRecipe` (dataset, view, composition, opts)
//     -> `PlotRecipe`. `saveAsPlotRecipe` below is its only store-side caller.
//   - `lib/plotRecipeMatch.ts`'s `resolveRecipe` (recipe, dataset) -> either
//     `{ refused }` (a technique mismatch or the errorRole guard -- a plot
//     that would be semantically WRONG if applied at all) or
//     `{ resolved, unmatched, warnings }` (an applicable mapping/visual plus
//     the fields that didn't resolve). `applyPlotRecipe` below is its only
//     store-side caller.
//
// CRUD shape mirrors `store/quickPlotTemplates.ts` (save/rename/delete, one
// `recordHistory` call each) with the same L0.31 divergence: saving or
// renaming under a name another recipe already holds NEVER overwrites or
// collides two rows onto one label -- it dedupes ("Name" -> "Name (2)",
// `lib/plotview.ts`'s `dedupeWindowTitle`) instead. `duplicatePlotRecipe`
// dedupes its own "<name> copy" base for the same reason, though the brief
// doesn't call it out by name -- two duplicates of the same recipe would
// otherwise collide on "<name> copy" the second time.
//
// ── APPLY PATH (F4.1/F4.3) ──────────────────────────────────────────────
// `applyPlotRecipe` resolves, then:
//   - `{ refused }` -> a status message, zero mutation.
//   - `unmatched.length > 0` -> zero mutation; the resolution is stashed as
//     `pendingRecipeApplication` for a preview+confirm UI (a later lane) to
//     render. `confirmPendingRecipeApplication` applies the RESOLVED SUBSET
//     exactly as a clean match would; `cancelPendingRecipeApplication` just
//     clears the pending state.
//   - a clean match (zero unmatched) applies immediately.
//
// "Applying" always CREATES A NEW FIGURE (never edits a live window in
// place) -- the same one-gesture, one-undo shape `quickFigureCreate.ts`'s
// `createQuickFigureFromMapping` (G4) uses: `createWindow` (store/windows.ts)
// fires the gesture's ONE `recordHistory` call; every later `set()` in
// `applyResolvedRecipe` rides along in that same undo unit with no further
// `recordHistory` of its own. Unlike `applyQuickPlotTemplate` (which can
// delegate to `createQuickFigureFromMapping` wholesale because a Quick Plot
// template's mapping IS a `QuickFigureMapping`), a resolved recipe carries
// strictly more than that shape can hold -- Y2/group/facet bindings, axis
// scale/range/format, legend, stacking, per-series style/label/order,
// hidden channels, and data-anchored decorations -- so this module builds
// the document directly from the SAME primitives `createQuickFigureFromMapping`
// itself is built from (`createWindow`, `lib/figureDocument.ts`'s
// `createFigureDocument`, `windowDocuments.ts`'s `withPlotWindowDocument`)
// rather than losing that fidelity by narrowing through the Quick Figure
// shape. `withPlotWindowDocument` is the declared `PlotWindow.document`
// write chokepoint (architecture.test.ts's "FigureDocument write
// chokepoint (F1)") -- this module never assigns `.document` directly.
//
// GAP (documented, not a bug): `resolved.visual.compositionKind` records
// WHICH arrangement (spatial/facet/break) was active at capture time, but
// is deliberately not turned back into a live composition here. Rebuilding
// actual panels needs the dataset-specific payload builders
// (`spatialComposition`/`facetComposition`/`breakComposition`,
// lib/composition.ts) with inputs this resolve step doesn't produce (per-
// panel placement, break ranges, ...) -- exactly why `lib/plotRecipe.ts`'s
// own header says the concrete panels are deliberately NOT captured. A
// later integration slice that has those inputs can read
// `compositionKind` off the resolution and rebuild them.
//
// PERSISTENCE: `plotRecipes` lives in memory only this lane (the
// `store/quickPlotTemplates.ts` PR-H two-commit precedent) -- `setPlotRecipes`
// exists so a later commit can wire `.dwk`/workspace load through it
// (`lib/plotRecipeIO.ts`'s `sanitizeRecipes` output is assumed already
// sanitized by that caller; this slice does not re-validate it).
//
// PRECEDENCE: deliberately NOT wired into `store/windowDefaults.ts`'s
// `datasetViewDefaults` (memory > technique defaults > density heuristic,
// `lib/techniqueViewMemory.ts`'s doc) -- applying a recipe is an explicit,
// opt-in gesture, never automatic (same L0.31 spirit CRUD above follows).
// `matchingPlotRecipes` is the pure read a future suggestion surface
// consults instead; it does not touch `datasetViewDefaults` at all.
//
// LAZY-LOADED (MAIN_PLAN #29 bundle-size budget): `useApp.ts` composes every
// slice eagerly, so a plain top-level `import` of `lib/plotRecipe.ts`/
// `lib/plotRecipeMatch.ts` would pull their ENTIRE capture/match logic (new
// weight -- nothing else in the eager graph reaches them yet) into the
// always-loaded bundle, ~7.7 kB over budget on its own. Per the budget
// script's own rule ("anything only needed after a user action can be a
// dynamic import()"), `recipeLibs()` below loads both modules on first use
// and caches the promise -- the four methods that actually need
// `captureRecipe`/`resolveRecipe` (save/apply/matching; `confirm` reuses an
// already-resolved result, see its own doc) are `async` for exactly that
// reason. Every OTHER action here (delete/rename/duplicate/set/cancel) is
// plain array CRUD needing neither library and stays fully synchronous.
// Only VALUE imports cost bytes -- the `import type` lines below (the
// `PlotRecipe`/`RecipeResolution`/... shapes) are erased at compile time and
// contribute nothing to this concern.

import { errKeysFromBindings } from "../lib/errorRoles";
import { createFigureDocument } from "../lib/figureDocument";
import type { PlotRecipe } from "../lib/plotRecipe";
import type {
  RecipeResolution,
  ResolvedRecipeApplication,
  ResolvedRecipeMapping,
  ResolvedRecipeVisual,
} from "../lib/plotRecipeMatch";
import { dedupeWindowTitle, defaultPlotView, snapshotView, type PlotView } from "../lib/plotview";
import { techniqueOf } from "../lib/techniqueDefaults";
import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";
import { nextFigureId } from "./figureLifecycle";
import { plotWindowDatasetId, withPlotWindowDocument } from "./windowDocuments";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

let _recipeSeq = 0;
const nextPlotRecipeId = (): string => `pr-${Date.now().toString(36)}-${++_recipeSeq}`;

interface RecipeLibs {
  captureRecipe: typeof import("../lib/plotRecipe").captureRecipe;
  resolveRecipe: typeof import("../lib/plotRecipeMatch").resolveRecipe;
}
let _recipeLibs: Promise<RecipeLibs> | null = null;
/** Load (once, then cache) the two pure wave-1 libraries this slice needs.
 *  See the module doc's LAZY-LOADED note. */
function recipeLibs(): Promise<RecipeLibs> {
  if (!_recipeLibs) {
    _recipeLibs = Promise.all([import("../lib/plotRecipe"), import("../lib/plotRecipeMatch")]).then(
      ([a, b]) => ({ captureRecipe: a.captureRecipe, resolveRecipe: b.resolveRecipe }),
    );
  }
  return _recipeLibs;
}

// No app-version constant is plumbed into the frontend bundle yet (no
// `import.meta.env`/package.json wiring anywhere in this repo today) --
// threading one through is out of this lane's scope. `captureRecipe`'s
// `appVersion` is provenance-only (never read back for gating), so a stable
// placeholder is a deliberate, low-risk stand-in for that future wiring.
const PLOT_RECIPE_APP_VERSION = "0";

/** A recipe resolution with `unmatched` fields, staged for a preview+confirm
 *  UI (a later lane) rather than applied immediately -- see the module doc. */
export interface PendingPlotRecipeApplication {
  recipe: PlotRecipe;
  datasetId: string;
  resolution: Extract<RecipeResolution, { resolved: ResolvedRecipeApplication }>;
}

/** Forward-compat options bag for `applyPlotRecipe` -- empty for now (this
 *  wave needs no flags); kept as an explicit parameter so a future caller
 *  (e.g. a "skip the preview, apply the resolved subset anyway" flag) need
 *  not change every existing call site's arity. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- deliberate forward-compat placeholder, see above
export interface ApplyPlotRecipeOptions {}

/** Re-key a resolved recipe's mapping+visual into a fresh `PlotView` seed --
 *  the same "start from `defaultPlotView()`, overlay only what the source
 *  actually specifies" shape `lib/quickFigureCommit.ts`'s `quickFigureCommit`
 *  uses. `errKeys` is the legacy symmetric-Y projection (the rich `errors`
 *  travel separately into the document via `createFigureDocument`'s own
 *  `errors` input, same split `createFigureDocument` itself makes). */
function viewFromResolved(mapping: ResolvedRecipeMapping, visual: ResolvedRecipeVisual): PlotView {
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

/** The apply gesture's entire body, shared by the clean-match path and
 *  `confirmPendingRecipeApplication` -- ONE `recordHistory` call (inside
 *  `createWindow`), everything else rides the same undo unit. Fails closed
 *  (false, a status message, no history entry, no new window/figure) if the
 *  dataset vanished between resolve and apply (a stale pending confirm, or a
 *  removal mid-gesture). */
function applyResolvedRecipe(
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

export interface PlotRecipesSlice {
  /** Every named saved plot recipe (F4). In-memory only this lane -- see the
   *  module doc's PERSISTENCE note. */
  plotRecipes: PlotRecipe[];
  /** A resolved-with-unmatched-fields apply, staged for preview+confirm.
   *  Null when no apply is pending. Exactly one at a time -- starting a new
   *  `applyPlotRecipe` call while one is pending simply replaces it (there is
   *  no queue; a UI offering the preview is expected to resolve it before the
   *  next apply gesture). */
  pendingRecipeApplication: PendingPlotRecipeApplication | null;
  /** Explicit save (L0.31: NEVER automatic) -- captures the FOCUSED plot
   *  window's live (dataset, view, composition) via `captureRecipe`. Fails
   *  closed (null, no history entry, no new recipe) when `datasetId` doesn't
   *  exist, or the focused window isn't a plot window bound to it (capturing
   *  against the wrong dataset's columns would silently build a signature
   *  that means nothing). A duplicate `name` is DEDUPED, never overwrites an
   *  existing recipe. Returns the new recipe's id. Async: lazy-loads
   *  `captureRecipe` on first use (see the module doc's LAZY-LOADED note) --
   *  every synchronous validation still runs (and can still fail closed)
   *  before that load starts. */
  saveAsPlotRecipe: (name: string, datasetId: string) => Promise<string | null>;
  /** No-op for an unknown id (mirrors `deleteQuickPlotTemplate`). Undoable. */
  deletePlotRecipe: (id: string) => void;
  /** No-op for an unknown id or a blank/unchanged name (mirrors
   *  `renameQuickPlotTemplate`). A name collision with another recipe
   *  DEDUPES rather than colliding two rows onto one label. Undoable. */
  renamePlotRecipe: (id: string, name: string) => void;
  /** No-op (null) for an unknown id. The copy's name dedupes against every
   *  existing recipe (never two recipes sharing a label). Undoable. Returns
   *  the new recipe's id. */
  duplicatePlotRecipe: (id: string) => string | null;
  /** Replace the whole list verbatim -- the future `.dwk`/persistence
   *  hookup's seam. The caller is assumed to have already sanitized `list`
   *  (`lib/plotRecipeIO.ts`'s `sanitizeRecipes`); this action does not
   *  re-validate it. Not undoable (mirrors `quickPlotTemplates: ws.
   *  quickPlotTemplates ?? []` at workspace load -- a load is not a user
   *  edit). */
  setPlotRecipes: (list: PlotRecipe[]) => void;
  /** Resolve `recipeId` against `datasetId`'s live dataset
   *  (`resolveRecipe`) and either apply immediately (a clean match),
   *  stage a `pendingRecipeApplication` (some fields unmatched -- zero
   *  mutation until confirmed), or refuse (zero mutation, a status message).
   *  Returns true only when a new figure was created THIS call -- a staged
   *  pending apply returns false, same as a refusal. Async: lazy-loads
   *  `resolveRecipe` (see the module doc's LAZY-LOADED note). */
  applyPlotRecipe: (recipeId: string, datasetId: string, opts?: ApplyPlotRecipeOptions) => Promise<boolean>;
  /** Apply the pending resolution's RESOLVED SUBSET (unmatched fields stay
   *  dropped, exactly as a clean match would have applied them) and clear
   *  `pendingRecipeApplication`. False, zero mutation, pending left cleared
   *  when nothing is pending, or the dataset vanished since resolve.
   *  Synchronous -- `pendingRecipeApplication` already carries a resolved
   *  `ResolvedRecipeApplication` from a PRIOR `resolveRecipe` call, so this
   *  needs neither library. */
  confirmPendingRecipeApplication: () => boolean;
  /** Discard the pending resolution without applying anything. */
  cancelPendingRecipeApplication: () => void;
  /** Every recipe scoped to `dataset`'s technique that `resolveRecipe`
   *  doesn't refuse, CLEAN matches (zero `unmatched`) first, then partial
   *  matches -- the ordering a suggestion surface (a later lane) renders
   *  directly. `"generic"` never matches anything (the recipe module's own
   *  stronger-than-memory rule) -- always `[]` for a generic dataset. Pure;
   *  never mutates state or applies anything. Async: lazy-loads
   *  `resolveRecipe` (see the module doc's LAZY-LOADED note). */
  matchingPlotRecipes: (dataset: Dataset) => Promise<PlotRecipe[]>;
}

export function createPlotRecipesSlice(set: SliceSet, get: SliceGet): PlotRecipesSlice {
  return {
    plotRecipes: [],
    pendingRecipeApplication: null,

    saveAsPlotRecipe: async (name, datasetId) => {
      // Load first, validate/read second: every state read below (including
      // `dedupedName`'s collision check) happens in ONE synchronous block
      // after this, so a second save/apply call started while THIS load is
      // in flight can't interleave with it and dedupe against a stale list.
      const { captureRecipe } = await recipeLibs();
      const state = get();
      const dataset = state.datasets.find((d) => d.id === datasetId);
      if (!dataset) {
        set({ status: "Save Plot Recipe unavailable: dataset not found" });
        return null;
      }
      const focused = state.plotWindows.find((w) => w.id === state.focusedWindowId);
      if (!focused || focused.kind !== "plot" || plotWindowDatasetId(focused) !== datasetId) {
        set({ status: "Save Plot Recipe unavailable: no focused plot window showing this dataset" });
        return null;
      }
      const baseName = name.trim() || "Untitled Plot Recipe";
      const dedupedName = dedupeWindowTitle(baseName, state.plotRecipes.map((r) => r.name));
      // The focused window's LIVE view is the singleton PlotView fields on
      // `state` (the "focused-window facade" contract, store/windows.ts's
      // header) -- `snapshotView` is the same read `windowsForSave`/
      // `duplicateWindow` use for it, never the window's own (stale-while-
      // focused) `.view` record.
      const view = snapshotView(state);
      const recipe = captureRecipe(dataset, view, state.composition, {
        id: nextPlotRecipeId(),
        name: dedupedName,
        appVersion: PLOT_RECIPE_APP_VERSION,
        mark: focused.document?.plot.mark,
        errors: focused.document?.bindings.errors,
        facetKey: focused.document?.bindings.facetKey ?? null,
        axisBreaks: focused.document?.plot.axisBreaks,
      });
      get().recordHistory("Save Plot Recipe");
      set((s) => ({ plotRecipes: [...s.plotRecipes, recipe] }));
      return recipe.id;
    },

    deletePlotRecipe: (id) => {
      if (!get().plotRecipes.some((r) => r.id === id)) return;
      get().recordHistory("Delete Plot Recipe");
      set((s) => ({ plotRecipes: s.plotRecipes.filter((r) => r.id !== id) }));
    },

    renamePlotRecipe: (id, name) => {
      const nm = name.trim();
      if (!nm) return;
      const recipes = get().plotRecipes;
      const src = recipes.find((r) => r.id === id);
      if (!src || src.name === nm) return;
      const otherNames = recipes.filter((r) => r.id !== id).map((r) => r.name);
      const dedupedName = dedupeWindowTitle(nm, otherNames);
      get().recordHistory("Rename Plot Recipe");
      const now = new Date().toISOString();
      set((s) => ({
        plotRecipes: s.plotRecipes.map((r) => (r.id === id ? { ...r, name: dedupedName, modifiedAt: now } : r)),
      }));
    },

    duplicatePlotRecipe: (id) => {
      const state = get();
      const src = state.plotRecipes.find((r) => r.id === id);
      if (!src) return null;
      get().recordHistory("Duplicate Plot Recipe");
      const dedupedName = dedupeWindowTitle(`${src.name} copy`, state.plotRecipes.map((r) => r.name));
      const now = new Date().toISOString();
      const copy: PlotRecipe = { ...structuredClone(src), id: nextPlotRecipeId(), name: dedupedName, createdAt: now, modifiedAt: now };
      set((s) => ({ plotRecipes: [...s.plotRecipes, copy] }));
      return copy.id;
    },

    setPlotRecipes: (list) => set({ plotRecipes: list }),

    applyPlotRecipe: async (recipeId, datasetId) => {
      const { resolveRecipe } = await recipeLibs();
      const state = get();
      const recipe = state.plotRecipes.find((r) => r.id === recipeId);
      if (!recipe) {
        set({ status: "Plot Recipe unavailable: recipe not found" });
        return false;
      }
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
    },

    confirmPendingRecipeApplication: () => {
      const pending = get().pendingRecipeApplication;
      if (!pending) return false;
      set({ pendingRecipeApplication: null });
      return applyResolvedRecipe(set, get, pending.recipe, pending.datasetId, pending.resolution.resolved);
    },

    cancelPendingRecipeApplication: () => set({ pendingRecipeApplication: null }),

    matchingPlotRecipes: async (dataset) => {
      const technique = techniqueOf(dataset);
      if (technique === "generic") return [];
      const { resolveRecipe } = await recipeLibs();
      const clean: PlotRecipe[] = [];
      const partial: PlotRecipe[] = [];
      for (const recipe of get().plotRecipes) {
        if (recipe.technique !== technique) continue;
        const resolution = resolveRecipe(recipe, dataset);
        if ("refused" in resolution) continue;
        (resolution.unmatched.length === 0 ? clean : partial).push(recipe);
      }
      return [...clean, ...partial];
    },
  };
}
