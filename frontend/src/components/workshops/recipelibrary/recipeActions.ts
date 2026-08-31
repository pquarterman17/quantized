// P3.5 slice 3 — ONE capability-gated entry point per Library row action.
//
// WHY THIS LIVES IN components/. The plot half of these operations is
// `../recipemanager/recipeManagerActions.ts`, which reaches into two stores;
// the name-keyed half is `lib/nameKeyedRecipes.ts`, a pure library. A
// dispatcher over both cannot live in `store/` — a store module importing a
// component inverts the layering — and it cannot live in `lib/`, which must
// not import `store/`. A component module may import both, so this is the one
// layer where the two halves legitimately meet. (An earlier attempt booked
// this as blocked on relocating recipeManagerActions into the store; that was
// wrong. Only a store-side dispatcher needs the move.)
//
// EVERY function here refuses rather than throws, and refuses FIRST on
// capability: `supportsOperation` is consulted before any store or storage is
// touched, so a UI that fails to grey out a button still cannot perform an
// operation the kind does not support. Belt and braces on purpose — the
// capability table exists to stop exactly the operations that destroy data on
// the systems that cannot take them.

import {
  duplicateNameKeyed,
  deleteNameKeyed,
  exportNameKeyed,
  importNameKeyed,
  renameNameKeyed,
  type NameKeyedKind,
} from "../../../lib/nameKeyedRecipes";
import {
  RECIPE_KIND_LABEL,
  supportsOperation,
  type RecipeKind,
  type RecipeRef,
} from "../../../lib/recipeLibrary";
import { saveBlob } from "../../../lib/download";
import { hydratedGlobalRecipes } from "../../../store/globalPlotRecipes";
import { useApp } from "../../../store/useApp";
import * as plotOps from "../recipemanager/recipeManagerActions";

export type ActionResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly reason: string };

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
    return useApp.getState().applyQuickPlotTemplate(ref.id, datasetId)
      ? { ok: true, message: "applied" }
      // The store already wrote a specific reason to `status` (which channel
      // resolution failed, or why the match was refused); repeating a vaguer
      // one here would talk over it.
      : { ok: false, reason: useApp.getState().status };
  }

  const recipe = plotRecipeFor(ref);
  if (!recipe) return { ok: false, reason: "that recipe no longer exists" };
  const applied = await plotOps.applyRecipeToDataset(recipe, datasetId);
  return applied
    ? { ok: true, message: "applied" }
    // Not necessarily a failure: an imperfect match STAGES a pending
    // application for confirmation instead of applying, and the store's
    // status says which. Reporting it as an error would be wrong.
    : { ok: false, reason: useApp.getState().status };
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
    return r.ok ? { ok: true, message: `renamed to "${r.name}"` } : r;
  }
  if (ref.kind === "quickPlot") {
    useApp.getState().renameQuickPlotTemplate(ref.id, wanted);
    return { ok: true, message: "renamed" };
  }
  if (!plotRecipeFor(ref)) return { ok: false, reason: "that recipe no longer exists" };
  plotOps.renameRecipe(ref.scope, ref.id, wanted);
  return { ok: true, message: "renamed" };
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

/** Will Ctrl+Z bring this back?
 *
 *  Only project-scope plot recipes and quick-plot templates are undo-tracked.
 *  The global plot store carries no history by design
 *  (store/globalPlotRecipes.ts's header) and the four name-keyed systems write
 *  straight to localStorage. Exported so the confirm dialog and the result
 *  message answer from ONE place — a dialog that says "you can undo this" over
 *  a delete that cannot be undone is worse than no dialog. */
export function deleteIsUndoable(ref: RecipeRef): boolean {
  if (ref.kind === "quickPlot") return true;
  return ref.kind === "plot" && ref.scope === "project";
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
