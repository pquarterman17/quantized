// On-demand loader for the plot-recipe apply path (bundle headroom slice 3,
// `plans/BUNDLE_HEADROOM.md`) — the `store/originApplyLibs.ts` shape, one
// level simpler because every caller is already `async`.
//
// `store/plotRecipeApply.ts` owns `resolveApplyOrStage`, `applyResolvedRecipe`,
// `resolvedCandidates` and `recipeLibs` — the whole apply/matching half of the
// Plot Recipe feature. `store/plotRecipes.ts` used to reach it with a plain
// static import, and `plotRecipes.ts` is composed into `useApp.ts`, so those
// 2,857 bundled bytes were a permanent startup cost for a module whose every
// entry point is a recipe gesture (save / apply / confirm a staged apply /
// list matches). Measured eager delta for this seam alone: see slice 3's table.
//
// WHY THE CALLERS DO NOT CHANGE SHAPE. All seven `plotRecipes.ts` actions that
// touch the apply path (`saveAsPlotRecipe`, `applyPlotRecipe`,
// `applyPlotRecipeObject`, `confirmPendingRecipeApplication`,
// `confirmPendingRecipeApplicationPartial`, `matchingPlotRecipes`,
// `cleanMatchingPlotRecipe`) were ALREADY `async`, because `recipeLibs()` —
// which lives inside `plotRecipeApply.ts` itself — was already awaited first in
// every one of them. So no public signature, return type or await count at a
// call site changes; one more already-lazy module is fetched on the same turn.
//
// FAILURE CONTRACT. A chunk that will not load rejects the action's existing
// promise. That is deliberately the SAME thing a failed `recipeLibs()` has
// always done from these call sites (it is an unguarded `Promise.all` of two
// dynamic imports), so this seam adds no new failure MODE — and, exactly like
// that one, the rejection happens before anything has mutated, so the project
// is provably untouched. A rejected `import()` is not cached by the module
// registry, so the next gesture refetches; a RESOLVED one is, which is why the
// promise is cached here only to keep concurrent callers on one fetch.
//
// NOTE: `store/plotRecipeApply.ts` must stay free of static importers that are
// reachable from the entry chunk, or the bundler folds it straight back in.
// `src/architecture.test.ts`'s SEAMS list is the guard.

type ApplyCore = typeof import("./plotRecipeApply");
type RecipeLibs = Awaited<ReturnType<ApplyCore["recipeLibs"]>>;

let inflight: Promise<ApplyCore> | null = null;

/** The plot-recipe apply/matching module, fetched once per session. */
export function applyCore(): Promise<ApplyCore> {
  inflight ??= import("./plotRecipeApply").catch((e: unknown) => {
    // Not cached on failure: drop the slot so the next gesture retries rather
    // than replaying one transient fetch failure for the rest of the session.
    inflight = null;
    throw e;
  });
  return inflight;
}

/** The apply module AND the capture/match libraries it loads through its own
 *  `recipeLibs()`, as one namespace — what every apply/save/confirm entry
 *  point needs before it reads any state, in one `await`. Deliberately NOT
 *  used by `resolvedCandidates`' callers: that function short-circuits on a
 *  `"generic"` technique BEFORE touching `recipeLibs()`, and folding the two
 *  loads together here would fetch the capture/match chunks for a dataset
 *  that can never match a recipe. */
export async function applyCoreWithLibs(): Promise<ApplyCore & RecipeLibs> {
  const core = await applyCore();
  return { ...core, ...(await core.recipeLibs()) };
}

/** Test-only: forget the cached promise so a spec can exercise the COLD
 *  (deferred) path, or a freshly `vi.doMock`ed module. Production code never
 *  calls this (same shape as `resetOriginApplyLibsForTests`). */
export function resetApplyCoreForTests(): void {
  inflight = null;
}
