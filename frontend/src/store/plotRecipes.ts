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
//     render. `cancelPendingRecipeApplication` just clears the pending state.
//   - a clean match (zero unmatched) applies immediately.
//
// `confirmPendingRecipeApplication` (finding 4, P1.3 wave-2 integration)
// never trusts the staged resolution as-is -- the dataset can change between
// stage and confirm, staling its column indices -- so it RE-RESOLVES fresh
// at confirm time and only ever applies THAT result (see its own doc).
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
// GAP (documented, not a bug -- NARROWED to spatial/break by F4.4,
// 2026-08-23): `resolved.visual.compositionKind` records which arrangement
// was active at capture time. FACET now round-trips with zero rebuild code
// in this module -- see `store/plotRecipeApply.ts`'s `applyResolvedRecipe`
// doc for how. SPATIAL/BREAK remain a real gap: their panels need inputs
// this resolve step genuinely can't produce (per-panel placement, break
// ranges) and have no bindings-owned carrier the way facet now does -- see
// `lib/plotRecipe.ts`'s header for why their panels are deliberately
// uncaptured. A later slice with those inputs can read `compositionKind`
// and rebuild via `spatialComposition`/`breakComposition` (lib/composition.ts).
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
// and caches the promise -- every method that needs `captureRecipe`/
// `resolveRecipe` (save/apply/matching/the manager-panel + suggestion-toast
// seams below; `confirm`/`confirmPartial` reuse an already-resolved result
// only to RE-resolve, see their own docs) is `async` for exactly that
// reason. Every OTHER action here (delete/rename/duplicate/set/cancel) is
// plain array CRUD needing neither library and stays fully synchronous.
// Only VALUE imports cost bytes -- the `import type` lines below (the
// `PlotRecipe`/`RecipeResolution`/... shapes) are erased at compile time and
// contribute nothing to this concern.
//
// APPLY-PATH EXTRACTION (P1.3 wave 3, Lane D headroom): `viewFromResolved`/
// `applyResolvedRecipe`/`resolveApplyOrStage` moved to the sibling
// `store/plotRecipeApply.ts` verbatim (see its own module doc) to fund this
// wave's additions under the 500-line general .ts ceiling. `resolveApplyOrStage`
// is the ONE seam `applyPlotRecipe` (below, recipe found by id in
// `state.plotRecipes`) and `applyPlotRecipeObject` (below, takes a `PlotRecipe`
// object directly -- the Recipe Manager panel's apply-a-GLOBAL-scope-recipe
// gesture needs this, since a global recipe is never a member of
// `state.plotRecipes`) both share.
//
// MATCHING EXTRACTION (P1.3 wave 3, Lane D code-review round): `recipeLibs`/
// `resolvedCandidates` also moved to the `plotRecipeApply.ts` sibling (its
// own MATCHING EXTRACTION note) -- code-review findings 4+6 pushed this
// file back over the 500-line ceiling; the existing eagerly-shared sibling
// avoids paying for a second module boundary against the eager-JS budget.

import type { PlotRecipe } from "../lib/plotRecipe";
import type { RecipeResolution, ResolvedRecipeApplication } from "../lib/plotRecipeMatch";
import { dedupeWindowTitle, snapshotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { plotWindowDatasetId } from "./windowDocuments";
import {
  applyResolvedRecipe,
  recipeLibs,
  resolveApplyOrStage,
  resolvedCandidates,
  type SliceGet,
  type SliceSet,
} from "./plotRecipeApply";

let _recipeSeq = 0;
const nextPlotRecipeId = (): string => `pr-${Date.now().toString(36)}-${++_recipeSeq}`;

/** Set-equality for two `unmatched` field-name lists (order-independent --
 *  `resolveRecipe` iterates `recipe.signature` in a stable order today, but
 *  comparing as sets is the honest contract: "the same fields, however
 *  listed" is what "nothing changed" means here, not "the same array"). */
function sameUnmatchedSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((x) => bSet.has(x));
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
  /** ORCHESTRATOR RULING B (code-review findings 2+3): add an EXTERNAL
   *  recipe (e.g. from the global scope; see store/globalPlotRecipes.ts's
   *  `copyIn` sibling) under a FRESH id -- never the source's own -- with
   *  its name deduped against the project list. Never reads or mutates the
   *  source; the caller (recipeManagerActions.ts's `copyRecipeToOtherScope`)
   *  owns finding it and deciding whether to remove/keep it. ONE undoable
   *  history entry -- undo removes ONLY the tracked copy, never touching
   *  wherever the source came from. Returns the new copy's id. */
  copyPlotRecipeIn: (recipe: PlotRecipe) => string;
  /** Replace the whole list verbatim -- the future `.dwk`/persistence
   *  hookup's seam. The caller is assumed to have already sanitized `list`
   *  (`lib/plotRecipeIO.ts`'s `sanitizeRecipes`); this action does not
   *  re-validate it. Not undoable (mirrors `quickPlotTemplates: ws.
   *  quickPlotTemplates ?? []` at workspace load -- a load is not a user
   *  edit). */
  setPlotRecipes: (list: PlotRecipe[]) => void;
  /** Look up `recipeId` -- PROJECT scope first, then (finding 4) the
   *  hydrated GLOBAL list on a project miss (composes with
   *  `matchingPlotRecipes`'s both-scope results) -- then resolve against
   *  `datasetId`'s live dataset and apply (clean match) / stage (unmatched)
   *  / refuse. True only when a new figure was created THIS call. Async:
   *  lazy-loads `resolveRecipe` (LAZY-LOADED note). */
  applyPlotRecipe: (recipeId: string, datasetId: string, opts?: ApplyPlotRecipeOptions) => Promise<boolean>;
  /** Same contract as `applyPlotRecipe`, but takes the `PlotRecipe` OBJECT
   *  directly instead of an id looked up across both scopes -- for a caller
   *  that already HAS it (the Recipe Manager panel; `PlotRecipe` is
   *  location-agnostic, `lib/plotRecipeStorage.ts`'s header). Async:
   *  lazy-loads `resolveRecipe` (LAZY-LOADED note). */
  applyPlotRecipeObject: (recipe: PlotRecipe, datasetId: string, opts?: ApplyPlotRecipeOptions) => Promise<boolean>;
  /** Confirm a staged apply. Never trusts the staged resolution -- RE-RESOLVES
   *  against `pending.datasetId`'s CURRENT dataset first (see the module
   *  doc's APPLY PATH note): dataset gone or refused -> status, pending
   *  cleared, zero mutation; clean fresh match -> applies THAT (never the
   *  stale one); still unmatched -> `pendingRecipeApplication` is REPLACED
   *  with the fresh resolution (never applied) plus a status naming why --
   *  "the dataset changed" ONLY when the fresh unmatched set genuinely
   *  differs from the staged one, else "N fields still unmatched" (ORCHESTRATOR
   *  RULING A, code-review finding 1: a modal, non-editable caller -- the
   *  removed dialog Confirm button -- would always reproduce the IDENTICAL
   *  set, so claiming "the dataset changed" there was false). False, pending
   *  left cleared, when nothing was pending. NOT called by
   *  PlotRecipeApplyDialog.tsx any more (see its own header) -- kept as
   *  public API for a future NON-modal caller, where the dataset genuinely
   *  can change between stage and confirm. Async: lazy-loads `resolveRecipe`
   *  to re-resolve. */
  confirmPendingRecipeApplication: () => Promise<boolean>;
  /** The explicit "apply anyway, drop unmatched" opt-in (booked in PR #204).
   *  Re-resolves against the CURRENT dataset exactly like
   *  `confirmPendingRecipeApplication` (the SAME staleness guard: a dataset
   *  edited between stage and confirm gets a fresh resolution, never the
   *  stale staged one) -- the one place the two diverge is what happens when
   *  the fresh resolution STILL has unmatched fields: `confirm` re-stages and
   *  refuses to apply; this action applies the fresh resolution's resolved
   *  subset regardless, with a status naming how many fields were dropped.
   *  Refused (technique mismatch / errorRole guard) or dataset-vanished still
   *  fail closed exactly like `confirm` -- "apply anyway" only ever waives
   *  UNMATCHED fields, never a refusal. False, pending left cleared, when
   *  nothing was pending. Async: lazy-loads `resolveRecipe` to re-resolve. */
  confirmPendingRecipeApplicationPartial: () => Promise<boolean>;
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
  /** The narrower read the post-import suggestion toast (deliverable 5)
   *  needs: `matchingPlotRecipes`'s own technique-gated candidate list, but
   *  returning only its recipe when the resolution is a CLEAN (zero
   *  `unmatched`) match -- offering a PARTIAL match behind a toast button
   *  would put a "review the mapping" gesture where "Apply recipe ‘X’?"
   *  promises a one-click apply, which is not the same offer. Null when
   *  there's no clean match (even if a partial one exists further down
   *  `matchingPlotRecipes`'s own list). Pure; never mutates state. Async:
   *  lazy-loads `resolveRecipe` (see the module doc's LAZY-LOADED note). */
  cleanMatchingPlotRecipe: (dataset: Dataset) => Promise<PlotRecipe | null>;
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
        facetKey: state.facetKey, // F4.4: the LIVE singleton -- the document copy is stale-while-focused
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

    copyPlotRecipeIn: (recipe) => {
      const state = get();
      const dedupedName = dedupeWindowTitle(recipe.name, state.plotRecipes.map((r) => r.name));
      const now = new Date().toISOString();
      const copy: PlotRecipe = { ...structuredClone(recipe), id: nextPlotRecipeId(), name: dedupedName, createdAt: now, modifiedAt: now };
      get().recordHistory("Copy Plot Recipe to Project");
      set((s) => ({ plotRecipes: [...s.plotRecipes, copy] }));
      return copy.id;
    },

    setPlotRecipes: (list) => set({ plotRecipes: list }),

    applyPlotRecipe: async (recipeId, datasetId) => {
      const { resolveRecipe } = await recipeLibs();
      // Finding 4: fall back to the hydrated global list on a project miss
      // (dynamic import, never static -- LAZY-LOADED note), so this composes
      // with matchingPlotRecipes's own both-scope results.
      let recipe = get().plotRecipes.find((r) => r.id === recipeId);
      if (!recipe) recipe = (await import("./globalPlotRecipes")).hydratedGlobalRecipes().find((r) => r.id === recipeId);
      if (!recipe) {
        set({ status: "Plot Recipe unavailable: recipe not found" });
        return false;
      }
      return resolveApplyOrStage(set, get, recipe, datasetId, resolveRecipe);
    },

    applyPlotRecipeObject: async (recipe, datasetId) => {
      const { resolveRecipe } = await recipeLibs();
      return resolveApplyOrStage(set, get, recipe, datasetId, resolveRecipe);
    },

    confirmPendingRecipeApplication: async () => {
      const pending = get().pendingRecipeApplication;
      if (!pending) {
        set({ status: "No pending Plot Recipe application to confirm" });
        return false;
      }
      // Finding 4: never trust `pending.resolution` as-is -- it was computed
      // at STAGE time and the dataset may have been edited since (a column
      // removed/reordered/recoded). Re-resolve against the CURRENT dataset
      // before applying anything.
      const dataset = get().datasets.find((d) => d.id === pending.datasetId);
      if (!dataset) {
        set({
          pendingRecipeApplication: null,
          status: `Plot Recipe "${pending.recipe.name}" unavailable: dataset not found`,
        });
        return false;
      }
      const { resolveRecipe } = await recipeLibs();
      const resolution = resolveRecipe(pending.recipe, dataset);
      if ("refused" in resolution) {
        set({
          pendingRecipeApplication: null,
          status: `Plot Recipe "${pending.recipe.name}" unavailable: ${resolution.refused}`,
        });
        return false;
      }
      if (resolution.unmatched.length > 0) {
        // Still not a clean match against the CURRENT dataset -- re-stage
        // the fresh resolution (never apply a stale one) and tell the user
        // why, so a second confirm always re-verifies rather than silently
        // compounding staleness.
        //
        // ORCHESTRATOR RULING A (code-review finding 1): "the dataset
        // changed since the preview" is only TRUE wording when the fresh
        // unmatched set actually differs from the staged one. The dialog
        // that used to call this action is modal (blocks dataset edits
        // while it's up) and only ever opens with unmatched > 0, so its own
        // "Confirm" click always reproduced the IDENTICAL set -- the wording
        // below distinguishes the two cases so a future non-modal caller
        // (this action's remaining reason to exist) doesn't inherit that
        // same false claim.
        set({
          pendingRecipeApplication: { recipe: pending.recipe, datasetId: pending.datasetId, resolution },
          status: sameUnmatchedSet(resolution.unmatched, pending.resolution.unmatched)
            ? `Plot Recipe "${pending.recipe.name}": ${resolution.unmatched.length} field${resolution.unmatched.length === 1 ? "" : "s"} still unmatched`
            : `Plot Recipe "${pending.recipe.name}": the dataset changed since the preview -- review the updated mapping`,
        });
        return false;
      }
      set({ pendingRecipeApplication: null });
      return applyResolvedRecipe(set, get, pending.recipe, pending.datasetId, resolution.resolved);
    },

    confirmPendingRecipeApplicationPartial: async () => {
      const pending = get().pendingRecipeApplication;
      if (!pending) {
        set({ status: "No pending Plot Recipe application to confirm" });
        return false;
      }
      // Same staleness guard as confirmPendingRecipeApplication: never trust
      // `pending.resolution` as-is, re-resolve against the CURRENT dataset.
      const dataset = get().datasets.find((d) => d.id === pending.datasetId);
      if (!dataset) {
        set({
          pendingRecipeApplication: null,
          status: `Plot Recipe "${pending.recipe.name}" unavailable: dataset not found`,
        });
        return false;
      }
      const { resolveRecipe } = await recipeLibs();
      const resolution = resolveRecipe(pending.recipe, dataset);
      if ("refused" in resolution) {
        set({
          pendingRecipeApplication: null,
          status: `Plot Recipe "${pending.recipe.name}" unavailable: ${resolution.refused}`,
        });
        return false;
      }
      // The one divergence from confirm: a still-non-empty `unmatched` here
      // does NOT re-stage -- this action's whole point is applying the fresh
      // resolution's resolved subset anyway, dropping whatever didn't match.
      const dropped = resolution.unmatched.length;
      set({ pendingRecipeApplication: null });
      const applied = applyResolvedRecipe(set, get, pending.recipe, pending.datasetId, resolution.resolved);
      if (applied && dropped > 0) {
        set({
          status: `applied plot recipe "${pending.recipe.name}" — dropped ${dropped} unmatched field${dropped === 1 ? "" : "s"}`,
        });
      }
      return applied;
    },

    cancelPendingRecipeApplication: () => set({ pendingRecipeApplication: null }),

    matchingPlotRecipes: async (dataset) => {
      const candidates = await resolvedCandidates(get, dataset);
      const clean: PlotRecipe[] = [];
      const partial: PlotRecipe[] = [];
      for (const { recipe, resolution } of candidates) {
        (resolution.unmatched.length === 0 ? clean : partial).push(recipe);
      }
      return [...clean, ...partial];
    },

    cleanMatchingPlotRecipe: async (dataset) => {
      // FINDING 6 (code-review, perf): shares `resolvedCandidates`'s ONE
      // resolve-per-candidate pass with `matchingPlotRecipes` above rather
      // than calling it and then re-resolving its first result AGAIN (the
      // old bug -- two `resolveRecipe` calls per candidate that mattered).
      const candidates = await resolvedCandidates(get, dataset);
      const clean = candidates.find((c) => c.resolution.unmatched.length === 0);
      return clean ? clean.recipe : null;
    },
  };
}
