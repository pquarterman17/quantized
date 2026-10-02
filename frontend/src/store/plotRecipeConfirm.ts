// The tails of `confirmPendingRecipeApplication` and its Partial variant,
// moved verbatim out of store/plotRecipes.ts (bundle diet slice 21,
// plans/BUNDLE_HEADROOM.md). Both actions already awaited the lazy apply core
// before this point, so the tail rides that same load (re-exported from
// store/plotRecipeApply.ts) and nothing about when or what it applies moves.
// The early refusals (no pending apply, dataset gone) stay in the slice,
// synchronous, as before. A core that will not load rejects the action's
// promise exactly as it always has (store/plotRecipeApplyLazy.ts's FAILURE
// CONTRACT).

import type { applyResolvedRecipe, resolveOptionsFor, ResolveRecipeFn, SliceGet, SliceSet } from "./plotRecipeApply";
import type { PendingPlotRecipeApplication } from "./pendingRecipeApplication";
import type { Dataset } from "../lib/types";

/** The parts of `applyCoreWithLibs()`'s namespace the tail uses. */
interface ConfirmLibs {
  applyResolvedRecipe: typeof applyResolvedRecipe;
  resolveOptionsFor: typeof resolveOptionsFor;
  resolveRecipe: ResolveRecipeFn;
}

/** Set-equality for two `unmatched` field-name lists (order-independent --
 *  `resolveRecipe` iterates `recipe.signature` in a stable order today, but
 *  comparing as sets is the honest contract: "the same fields, however
 *  listed" is what "nothing changed" means here, not "the same array"). */
function sameUnmatchedSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((x) => bSet.has(x));
}

/** Re-resolve a staged apply against the CURRENT dataset and apply it.
 *  `partial` false is `confirmPendingRecipeApplication` (a still-unmatched
 *  field re-stages); true is the Partial variant (applies the resolved subset
 *  and names how many fields it dropped). */
export async function confirmStagedRecipe(
  set: SliceSet,
  get: SliceGet,
  libs: ConfirmLibs,
  pending: PendingPlotRecipeApplication,
  dataset: Dataset,
  partial: boolean,
): Promise<boolean> {
  const { applyResolvedRecipe, resolveOptionsFor, resolveRecipe } = libs;
  const resolution = resolveRecipe(pending.recipe, dataset, resolveOptionsFor(get, pending));
  if ("refused" in resolution) {
    set({ pendingRecipeApplication: null, status: `Plot Recipe "${pending.recipe.name}" unavailable: ${resolution.refused}` });
    return false;
  }
  if (!partial && resolution.unmatched.length > 0) {
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
      pendingRecipeApplication: { ...pending, resolution }, // keeps `onCancel`
      status: sameUnmatchedSet(resolution.unmatched, pending.resolution.unmatched)
        ? `Plot Recipe "${pending.recipe.name}": ${resolution.unmatched.length} field${resolution.unmatched.length === 1 ? "" : "s"} still unmatched`
        : `Plot Recipe "${pending.recipe.name}": the dataset changed since the preview -- review the updated mapping`,
    });
    return false;
  }
  if (!partial) {
    set({ pendingRecipeApplication: null });
    return applyResolvedRecipe(set, get, pending.recipe, pending.datasetId, resolution.resolved);
  }
  // The one divergence from confirm: a still-non-empty `unmatched` here
  // does NOT re-stage -- this action's whole point is applying the fresh
  // resolution's resolved subset anyway, dropping whatever didn't match.
  const dropped = resolution.unmatched.length;
  set({ pendingRecipeApplication: null });
  const applied = await applyResolvedRecipe(set, get, pending.recipe, pending.datasetId, resolution.resolved);
  if (applied && dropped > 0) {
    set({
      status: `applied plot recipe "${pending.recipe.name}" — dropped ${dropped} unmatched field${dropped === 1 ? "" : "s"}`,
    });
  }
  return applied;
}
