// Post-import batch-outcome toast (extracted from store/importDatasets.ts's
// `runImport`, P1.3 wave 3, Lane D headroom): importDatasets.ts sits right at
// its general .ts ceiling (architecture.test.ts, 500 lines, unpinned), so the
// new recipe-suggestion offer (deliverable 5) needed somewhere else to land
// rather than pushing that file over. `batchOverlayOffer` moved here
// verbatim (unchanged behavior); `presentBatchOutcome` is the toast-decision
// cascade that used to be `runImport`'s own `if (added > 0) { ... }` block,
// now with a third candidate offer folded in.
//
// L0.46 PRECEDENCE (extended this wave): never stack two action toasts for
// one import gesture. The existing rule was "overlay beats folder"; the
// recipe-suggestion offer is added as the LOWEST-priority candidate — it
// only ever fires when NEITHER the overlay nor the folder offer qualified.
// This is a deliberate choice, not an oversight: the overlay/folder offers
// are the more IMMEDIATE payoff of a multi-file batch (a plot showing every
// series at once, or a tidy home for a bunch of same-prefix files) and were
// shipped first; the recipe offer is the narrower, single-dataset case
// (`createdIds.length === 1` below) that the other two gates would already
// exclude on a real multi-dataset batch (a technique mismatch or an
// already-existing folder), so in practice the three rarely even compete for
// the same gesture — but keeping the same "one action toast, ranked" shape
// as the existing rule means adding a fourth future offer later only ever
// needs one more `if`, never a redesign.
//
// NEVER AUTO-APPLIES: the suggestion is a toast BUTTON, not a background
// apply — declining (or letting it time out) leaves the dataset exactly as
// imported, same "offer, never force" contract `batchOverlayOffer`'s own doc
// states. Technique-gated by `cleanMatchingPlotRecipe` itself (generic
// datasets and mismatched techniques never produce a candidate).
//
// FINDING 7 (code-review): every OTHER candidate toast in this cascade
// states the import itself succeeded ("N files imported — overlay…?", "N
// files imported — create folder…?"), and the plain fallback is "imported N
// files" — this recipe-suggestion toast is not a fourth, silent exception:
// its text also leads with "imported N file(s)" before the recipe question,
// so a user who only reads the toast's opening words still learns their
// import landed, regardless of which of the four candidates fired.
//
// FINDING 6 (code-review, perf): this branch's `dataset ? await
// get().cleanMatchingPlotRecipe(dataset) : null` used to run unconditionally
// for every single-dataset import, including one with ZERO saved recipes in
// EITHER scope — needlessly triggering `cleanMatchingPlotRecipe`'s own
// dynamic `lib/plotRecipeMatch.ts` load (see store/plotRecipes.ts's
// LAZY-LOADED doc) on every plain import. The cheap project-list length
// check runs first (already in memory, no import needed); the global list is
// hydrated (a synchronous localStorage read, `hydratedGlobalRecipes()` —
// itself dynamically imported here to keep THIS already-eager module from
// dragging the otherwise-lazy global store into the main bundle) only when
// the project list alone didn't already prove there's a candidate.

import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import { techniqueOf } from "../lib/techniqueDefaults";
import type { Technique } from "../lib/types";
import { batchFolderOffer, createFolderForBatch } from "./importTargetFolder";
import { TOAST_ACTION_TTL, toast } from "./toasts";
import type { AppState } from "./useApp";

type SliceGet = () => AppState;

/** PLOT_WORKFLOW_PLAN item 4: when a batch import's successfully-created
 *  datasets all resolve to the SAME non-generic technique, offer ONE overlay
 *  plot instead of leaving N separate ones — offer, never force (declining
 *  or letting the toast time out is exactly today's per-file behavior, the
 *  batch datasets stay in the Library regardless). Two files that both
 *  happen to be "generic" are not knowably similar (the plan's mixed-batch
 *  rule), so `generic` never qualifies even when it's the only tag present.
 *
 *  Counts by DATASET id rather than by file, but that's equivalent for
 *  every batch that can actually pass this gate: the only import that turns
 *  one file into several datasets is an Origin multi-book project, and item
 *  1 stamps Origin imports `generic` unconditionally — so a book-expansion
 *  batch always fails the non-generic check before the file/dataset count
 *  distinction would matter. */
export function batchOverlayOffer(
  get: SliceGet,
  createdIds: readonly string[],
): { technique: Technique; ids: string[] } | null {
  if (createdIds.length < 2) return null;
  const idSet = new Set(createdIds);
  const datasets = get().datasets.filter((d) => idSet.has(d.id));
  if (datasets.length < 2) return null;
  const techniques = new Set(datasets.map((d) => techniqueOf(d)));
  if (techniques.size !== 1) return null;
  const [technique] = techniques;
  if (technique === "generic") return null;
  return { technique, ids: datasets.map((d) => d.id) };
}

/** Present the ONE batch-outcome toast for a just-finished import (`added`
 *  files landed, `createdIds` the datasets they produced) — ranked
 *  candidates, first match wins, per L0.46 above: overlay, then folder, then
 *  (this wave) a clean-matching Plot Recipe suggestion, then the plain
 *  "imported N files" fallback. */
export async function presentBatchOutcome(
  get: SliceGet,
  added: number,
  createdIds: readonly string[],
  targetFolderId: string | undefined,
): Promise<void> {
  const offer = batchOverlayOffer(get, createdIds);
  // If BOTH the overlay and folder offers would qualify, the overlay wins
  // (L0.46 — never stack two action toasts for one batch); the offer toast
  // states "imported" itself, so it replaces (not supplements) any other
  // toast below.
  const folderOffer = offer ? null : batchFolderOffer(get, createdIds, added);
  if (offer) {
    toast(`${offer.ids.length} ${offer.technique} files imported — overlay in one plot?`, "ok", {
      action: { label: "Overlay", onClick: () => void plotSelectedTogether(offer.ids) },
      ttlMs: TOAST_ACTION_TTL,
    });
    return;
  }
  if (folderOffer) {
    toast(`${folderOffer.ids.length} files imported — create folder "${folderOffer.prefix}"?`, "ok", {
      action: {
        label: `Create folder "${folderOffer.prefix}"`,
        onClick: () => createFolderForBatch(get, folderOffer.prefix, folderOffer.ids, targetFolderId),
      },
      ttlMs: TOAST_ACTION_TTL,
    });
    return;
  }
  // The recipe-suggestion offer: only for the common single-dataset import.
  // A multi-dataset batch that reached here already failed the overlay/
  // folder gates for a REASON (mixed techniques, or an already-existing
  // folder) — matching a recipe against just one of several imported
  // datasets would be an arbitrary pick, not a suggestion.
  //
  // FINDING 6: skip `cleanMatchingPlotRecipe` (and its dynamic
  // `lib/plotRecipeMatch.ts` load) entirely when NEITHER scope has a single
  // saved recipe — there is no candidate it could possibly find. The project
  // list is already in memory, so it's checked first; the global list is
  // only hydrated (dynamically imported) when that alone didn't settle it.
  if (createdIds.length === 1) {
    // FINDING 3 (final code-review round): this whole branch is wrapped so
    // `presentBatchOutcome` can NEVER reject. The caller
    // (importDatasets.ts's `runImport`) awaits this call and then
    // unconditionally checks `if (lastError) toast(..., "danger")` right
    // after it -- an uncaught rejection here (e.g. a dynamic chunk-load
    // failure in `cleanMatchingPlotRecipe`'s own `recipeLibs()`/
    // `globalPlotRecipes.ts` imports) would propagate out of this function,
    // skip that danger toast for a genuinely failed file, AND leak an
    // unhandled rejection out of `runImport` -- a suggestion feature must
    // never be able to break error reporting for an unrelated failure in
    // the same batch. A failure here silently degrades to the plain
    // "imported N" toast below, exactly like "no clean match found" already
    // does.
    try {
      const hasProjectRecipes = get().plotRecipes.length > 0;
      const hasAnyRecipes =
        hasProjectRecipes || (await import("./globalPlotRecipes")).hydratedGlobalRecipes().length > 0;
      const dataset = hasAnyRecipes ? get().datasets.find((d) => d.id === createdIds[0]) : undefined;
      const recipe = dataset ? await get().cleanMatchingPlotRecipe(dataset) : null;
      if (recipe && dataset) {
        // FINDING 7: lead with "imported N file(s)" like every other
        // candidate toast in this cascade, not a silent exception.
        toast(`imported ${added} file${added === 1 ? "" : "s"} — apply recipe "${recipe.name}"?`, "ok", {
          action: { label: "Apply", onClick: () => void get().applyPlotRecipeObject(recipe, dataset.id) },
          ttlMs: TOAST_ACTION_TTL,
        });
        return;
      }
    } catch {
      // Fall through to the plain toast below.
    }
  }
  toast(`imported ${added} file${added === 1 ? "" : "s"}`, "ok");
}
