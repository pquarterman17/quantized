// P3.5 slice 3 — ONE capability-gated entry point per Library row action.
//
// WHY THIS LIVES IN components/. The plot half of these operations is
// `../recipemanager/recipeManagerActions.ts` — a COMPONENT module. The one
// rule actually enforced here (architecture.test.ts's "lib/ layering guard")
// bans new `lib/` -> `components/` imports, so a dispatcher that needs that
// module cannot live in `lib/`. It COULD live in `store/` — store modules do
// import components today — but a component importing both halves adds no
// cross-layer edge at all, which makes this the cheapest honest home.
//
// Do NOT read a general "lib must not import store" rule into that: 25
// non-test lib modules already import store, and no test forbids it. (#277
// booked this dispatcher as blocked on relocating recipeManagerActions into
// the store; that was wrong — only a store-side dispatcher would need it.)
//
// EVERY function here refuses rather than throws: a stale ref, a kind without
// a serializer, or a malformed import file are ordinary outcomes, not bugs.
//
// The five OPTIONAL operations (rename, duplicate, export, import, copyScope)
// consult `supportsOperation` before touching any store or storage, so a UI
// that fails to hide a button still cannot perform an operation the kind
// cannot take. `applyOrOpen` and `deleteRecipe` deliberately do not: every
// kind supports both, `supportsOperation` hard-returns true for them, and a
// guard that can never fire is a guard nobody maintains. If a read-only kind
// ever arrives, those two gain the check along with the flag.

import {
  duplicateNameKeyed,
  deleteNameKeyed,
  exportNameKeyed,
  importNameKeyed,
  renameNameKeyed,
  type NameKeyedKind,
} from "../../../lib/nameKeyedRecipes";
import {
  deleteIsUndoable,
  RECIPE_KIND_LABEL,
  supportsOperation,
  type RecipeKind,
  type RecipeRef,
} from "../../../lib/recipeLibrary";
import { saveBlob } from "../../../lib/download";
import { hydratedGlobalRecipes } from "../../../store/globalPlotRecipes";
import { useApp } from "../../../store/useApp";
import * as plotOps from "../recipemanager/recipeManagerActions";

// Re-exported so the row UI reads the delete-undoability rule from the same
// place `recipeIndex.pruneEntries` does.
export { deleteIsUndoable };

/** Three outcomes, not two. `pending` exists because an imperfect plot-recipe
 *  match neither applies nor fails: it STAGES a confirmation elsewhere. Folding
 *  that into `ok: false` styled it as a refusal, which the code comment
 *  claiming otherwise did not prevent. */
export type ActionResult =
  /** `ref` is where the row ENDED UP. For the four name-keyed kinds the id is
   *  the name, so a rename moves the row to a new identity and the caller
   *  cannot derive it from the input ref -- the panel needs it to put keyboard
   *  focus back on the row it just renamed. Absent when the operation did not
   *  produce a row (import, export). */
  | { readonly ok: true; readonly message: string; readonly ref?: RecipeRef }
  | { readonly ok: false; readonly pending?: false; readonly reason: string }
  | { readonly ok: false; readonly pending: true; readonly reason: string };

const NAME_KEYED = new Set<RecipeKind>(["analysis", "peak", "graph", "fitModel"]);
const isNameKeyed = (kind: RecipeKind): kind is NameKeyedKind => NAME_KEYED.has(kind);

function unsupported(ref: RecipeRef, verb: string): ActionResult {
  return { ok: false, reason: `${RECIPE_KIND_LABEL[ref.kind]}s cannot be ${verb} yet` };
}

/** The plot recipe behind a ref, from whichever scope it claims. Null when it
 *  has been deleted since the list was rendered — a normal race with another
 *  tab or an undo, never an exception. */
function plotRecipeFor(ref: RecipeRef) {
  return ref.scope === "project"
    ? (useApp.getState().plotRecipes.find((r) => r.id === ref.id) ?? null)
    : (hydratedGlobalRecipes().find((r) => r.id === ref.id) ?? null);
}

/** Which workshop owns a kind — the honest meaning of "open" for the four
 *  that have no in-Library apply. Applying a peak recipe means loading it into
 *  the Peak Analyzer and stepping through; the Library's job is to get the
 *  user there, not to pretend it can run it. */
const WORKSHOP_OPENERS: Record<NameKeyedKind, { label: string; open: () => void }> = {
  analysis: { label: "Pipeline", open: () => useApp.getState().setPipelineOpen(true) },
  peak: { label: "Peak Analyzer", open: () => useApp.getState().setPeakWizardOpen(true) },
  graph: { label: "Figure Builder", open: () => useApp.getState().setFigureBuilderOpen(true) },
  fitModel: { label: "Curve Fit", open: () => useApp.getState().setCurveFitOpen(true) },
};

/** The primary row action. Two genuinely different verbs behind one entry
 *  point, and the UI must LABEL them differently (`primaryActionLabel`): plot
 *  and quick-plot recipes apply to a dataset here and now; the other four open
 *  the workshop that owns them. Collapsing that into one word would promise an
 *  apply the Library cannot perform. */
export async function applyOrOpen(ref: RecipeRef): Promise<ActionResult> {
  if (isNameKeyed(ref.kind)) {
    const opener = WORKSHOP_OPENERS[ref.kind];
    opener.open();
    return { ok: true, message: `opened ${opener.label}` };
  }

  const datasetId = useApp.getState().activeId;
  if (!datasetId) return { ok: false, reason: "select a dataset first" };

  if (ref.kind === "quickPlot") {
    // This path DOES write `status` synchronously on every refusal
    // (`applyQuickPlotTemplate` sets it before each early return), so echoing
    // it names the channel that failed to resolve rather than talking over it.
    return useApp.getState().applyQuickPlotTemplate(ref.id, datasetId)
      ? { ok: true, message: "applied" }
      : { ok: false, reason: useApp.getState().status };
  }

  const recipe = plotRecipeFor(ref);
  if (!recipe) return { ok: false, reason: "that recipe no longer exists" };
  // Snapshot BEFORE the await. The plot path is not uniformly chatty: the
  // staging branch of `resolveApplyOrStage` sets `pendingRecipeApplication`
  // and returns false WITHOUT writing `status`, so reading it afterwards
  // surfaced whatever unrelated message happened to be sitting there — a
  // stale line from another action, presented as this one's reason.
  // Snapshot the pending application by IDENTITY, not truthiness: one may
  // already be sitting there un-confirmed from an earlier apply, and testing
  // `after.pendingRecipeApplication` alone reported a fresh REFUSAL as
  // "staged", suppressing its real reason and pointing the user at the wrong
  // recipe to confirm.
  const pendingBefore = useApp.getState().pendingRecipeApplication;
  const applied = await plotOps.applyRecipeToDataset(recipe, datasetId);
  if (applied) return { ok: true, message: "applied" };

  const after = useApp.getState();
  if (after.pendingRecipeApplication && after.pendingRecipeApplication !== pendingBefore) {
    // Staged, not failed: some fields did not match, so the store is holding a
    // resolution for the user to confirm in the Plot Recipe manager.
    return {
      ok: false,
      pending: true,
      reason: "some fields did not match — confirm in Manage Plot Recipes…",
    };
  }
  // Not staged, so this call wrote the reason itself: every other false-return
  // path in `resolveApplyOrStage`/`applyResolvedRecipe` sets `status` before
  // returning. Comparing against a pre-await snapshot was wrong in the other
  // direction — a repeat click producing the SAME message read as "unchanged"
  // and got replaced by a vaguer one.
  return { ok: false, reason: after.status || "could not apply that recipe" };
}

/** Label for `applyOrOpen`, so the button never says "Apply" for a kind that
 *  can only be opened. */
export function primaryActionLabel(kind: RecipeKind): string {
  return isNameKeyed(kind) ? `Open in ${WORKSHOP_OPENERS[kind].label}` : "Apply";
}

export function renameRecipe(ref: RecipeRef, name: string): ActionResult {
  if (!supportsOperation(ref.kind, "rename")) return unsupported(ref, "renamed");
  const wanted = name.trim();
  if (wanted === "") return { ok: false, reason: "name cannot be empty" };

  if (isNameKeyed(ref.kind)) {
    const r = renameNameKeyed(ref.kind, ref.id, wanted);
    // `r.name` is the name ACTUALLY used, which differs from `wanted` when a
    // collision forced a dedupe -- so the new ref has to come from it, not
    // from what the user typed.
    return r.ok
      ? { ok: true, message: `renamed to "${r.name}"`, ref: { ...ref, id: r.name } }
      : r;
  }
  if (ref.kind === "quickPlot") {
    // `renameQuickPlotTemplate` silently no-ops for an unknown id, so without
    // this check a rename racing a delete reports success while nothing
    // happened — the same false success the plot branch below already guards.
    if (!useApp.getState().quickPlotTemplates.some((t) => t.id === ref.id)) {
      return { ok: false, reason: "that template no longer exists" };
    }
    useApp.getState().renameQuickPlotTemplate(ref.id, wanted);
    return { ok: true, message: "renamed", ref }; // stable id: the row does not move
  }
  if (!plotRecipeFor(ref)) return { ok: false, reason: "that recipe no longer exists" };
  plotOps.renameRecipe(ref.scope, ref.id, wanted);
  return { ok: true, message: "renamed", ref }; // stable id: the row does not move
}

export function duplicateRecipe(ref: RecipeRef): ActionResult {
  if (!supportsOperation(ref.kind, "duplicate")) return unsupported(ref, "duplicated");
  if (isNameKeyed(ref.kind)) {
    const r = duplicateNameKeyed(ref.kind, ref.id);
    return r.ok ? { ok: true, message: `duplicated as "${r.name}"` } : r;
  }
  const id = plotOps.duplicateRecipe(ref.scope, ref.id);
  return id ? { ok: true, message: "duplicated" } : { ok: false, reason: "that recipe no longer exists" };
}

export function deleteRecipe(ref: RecipeRef): ActionResult {
  if (isNameKeyed(ref.kind)) {
    const r = deleteNameKeyed(ref.kind, ref.id);
    return r.ok ? { ok: true, message: "deleted" } : r;
  }
  if (ref.kind === "quickPlot") {
    if (!useApp.getState().quickPlotTemplates.some((t) => t.id === ref.id)) {
      return { ok: false, reason: "that template no longer exists" };
    }
    useApp.getState().deleteQuickPlotTemplate(ref.id);
    return { ok: true, message: "deleted — undo restores it" };
  }
  if (!plotRecipeFor(ref)) return { ok: false, reason: "that recipe no longer exists" };
  plotOps.deleteRecipe(ref.scope, ref.id);
  return { ok: true, message: deleteIsUndoable(ref) ? "deleted — undo restores it" : "deleted" };
}

/** Downloads a file. The sidecar's favorite/tags are NOT included: they are
 *  how THIS person uses the recipe, and shipping them into a colleague's copy
 *  is the reason the index is a sidecar in the first place. */
export function exportRecipe(ref: RecipeRef): ActionResult {
  if (!supportsOperation(ref.kind, "export")) return unsupported(ref, "exported");
  if (isNameKeyed(ref.kind)) {
    const r = exportNameKeyed(ref.kind, ref.id);
    if (!r.ok) return r;
    saveBlob(
      new Blob([r.text], { type: "application/json" }),
      `${r.name.replace(/[^A-Za-z0-9._-]/g, "_")}.qzt.json`,
    );
    return { ok: true, message: "exported" };
  }
  const recipe = plotRecipeFor(ref);
  if (!recipe) return { ok: false, reason: "that recipe no longer exists" };
  plotOps.exportRecipe(recipe);
  return { ok: true, message: "exported" };
}

export function importRecipe(kind: RecipeKind, scope: RecipeRef["scope"], text: string): ActionResult {
  if (!supportsOperation(kind, "import")) {
    return { ok: false, reason: `${RECIPE_KIND_LABEL[kind]}s cannot be imported yet` };
  }
  if (isNameKeyed(kind)) {
    const r = importNameKeyed(kind, text);
    return r.ok ? { ok: true, message: `imported as "${r.name}"` } : r;
  }
  try {
    plotOps.importRecipeToScope(scope, text); // throws its own message verbatim
    return { ok: true, message: "imported" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "not a valid recipe file" };
  }
}

/** Plot only, and derived from `scopes` rather than a second flag: a kind that
 *  lives in one place has nowhere to copy to. Copies, never moves — the source
 *  is untouched, so an undo of the copy cannot lose the original. */
export function copyToOtherScope(ref: RecipeRef): ActionResult {
  if (!supportsOperation(ref.kind, "copyScope")) return unsupported(ref, "copied between project and global");
  if (!plotRecipeFor(ref)) return { ok: false, reason: "that recipe no longer exists" };
  const id = plotOps.copyRecipeToOtherScope(ref.scope, ref.id);
  const destination = ref.scope === "project" ? "global" : "this project";
  return id ? { ok: true, message: `copied to ${destination}` } : { ok: false, reason: "copy failed" };
}
