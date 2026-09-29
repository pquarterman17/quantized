// Recipe Manager panel actions (P1.3 wave 3, Lane D deliverable 3). Plain
// functions over the two live stores (store/plotRecipes.ts's project-scoped
// `plotRecipes`, store/globalPlotRecipes.ts's global `recipes`) rather than a
// React hook -- none of this needs component state, so it is unit-testable
// directly against the real stores, the same "extracted UI-adjacent action
// module" shape components/windows/figureLifecycleUi.ts uses for
// store/plotRecipes.ts's OWN focused-window gesture.
//
// `PlotRecipe` is location-agnostic (lib/plotRecipeStorage.ts's header) --
// `copyRecipeToOtherScope` below is the one place that actually copies the
// OBJECT between the two lists (ORCHESTRATOR RULING B, code-review findings
// 2+3 -- see store/globalPlotRecipes.ts's module doc for the full "why copy,
// not move" rationale); every other action here operates on whichever single
// list `scope` names.

import { exportRecipeFile, importRecipeFile } from "../../../lib/plotRecipeStorage";
import type { PlotRecipe } from "../../../lib/plotRecipe";
import { saveBlob } from "../../../lib/download";
import { hydratedGlobalRecipes, useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
// Static on purpose: this module is already in the eager bundle, and a
// dynamic import of it split it into its own eager chunk (+517 B measured).
import { removeDatasetsPatch, scrubDatasetsFromHistory } from "../../../store/removeDatasets";
import { useApp } from "../../../store/useApp";

// Re-exported, not redeclared: storage scope is a domain fact (see
// lib/recipeLibrary.ts, which the unified Recipe Library also builds on), and
// two copies of the same union is how the Library and this panel would
// eventually disagree about what "global" means. Type-only, so it costs
// nothing at runtime.
import type { RecipeScope } from "../../../lib/recipeLibrary";

export type { RecipeScope };

export interface RecipeRow {
  scope: RecipeScope;
  recipe: PlotRecipe;
}

/** Every recipe across BOTH scopes, project first -- the manager panel's one
 *  read. Pure (a snapshot of whatever the two stores hold right now); the
 *  panel re-derives this on every render via its own store subscriptions,
 *  this function just does the concatenation + tagging. */
export function combinedRecipeRows(project: readonly PlotRecipe[], global: readonly PlotRecipe[]): RecipeRow[] {
  return [
    ...project.map((recipe) => ({ scope: "project" as const, recipe })),
    ...global.map((recipe) => ({ scope: "global" as const, recipe })),
  ];
}

export function renameRecipe(scope: RecipeScope, id: string, name: string): void {
  if (scope === "project") useApp.getState().renamePlotRecipe(id, name);
  else useGlobalPlotRecipes.getState().rename(id, name);
}

export function duplicateRecipe(scope: RecipeScope, id: string): string | null {
  return scope === "project" ? useApp.getState().duplicatePlotRecipe(id) : useGlobalPlotRecipes.getState().duplicate(id);
}

export function deleteRecipe(scope: RecipeScope, id: string): void {
  if (scope === "project") useApp.getState().deletePlotRecipe(id);
  else useGlobalPlotRecipes.getState().remove(id);
}

/** ORCHESTRATOR RULING B (code-review findings 2+3): copy `id` (found in
 *  `scope`) into the OTHER scope under a FRESH id (never the source's own --
 *  closes finding 3's dual-id cause) with its name deduped against the
 *  destination list (never colliding two rows onto one label there, same
 *  L0.31 rule every other recipe rename/duplicate/save already follows).
 *  The SOURCE is NEVER touched -- no removal, no source-side mutation of any
 *  kind -- which is what closes finding 2's undo-data-loss bug: there is no
 *  source-side write for an undo to ever lose track of. Copy-to-project
 *  records ONE undoable history entry (`copyPlotRecipeIn`); undoing it
 *  removes ONLY the tracked copy. Copy-to-global is not undo-tracked, same
 *  as every other action on that store (global scope carries no undo
 *  history, by design -- see store/globalPlotRecipes.ts's header) -- and
 *  needs none, since nothing was ever removed anywhere. A user who wants
 *  MOVE semantics deletes the source afterward (the Recipe Manager panel's
 *  copy button says so in its own title text). No-op (null) for an unknown
 *  id. Returns the new copy's id. */
export function copyRecipeToOtherScope(scope: RecipeScope, id: string): string | null {
  if (scope === "project") {
    const recipe = useApp.getState().plotRecipes.find((r) => r.id === id);
    if (!recipe) return null;
    return useGlobalPlotRecipes.getState().copyIn(recipe);
  }
  const recipe = hydratedGlobalRecipes().find((r) => r.id === id);
  if (!recipe) return null;
  return useApp.getState().copyPlotRecipeIn(recipe);
}

/** Apply a recipe (either scope) to `datasetId` -- routes through the ONE
 *  canonical apply path (`applyPlotRecipeObject`, store/plotRecipes.ts) that
 *  never depends on `recipe` being a member of the project list. */
export function applyRecipeToDataset(recipe: PlotRecipe, datasetId: string): Promise<boolean> {
  return useApp.getState().applyPlotRecipeObject(recipe, datasetId);
}

/** What the user picked in the Recipe Manager's apply row (F4.2 / audit
 *  P1.3). Both default to "as the recipe says": the transformation it
 *  recorded when that is still saved (`recordedTransformChoice`, else none),
 *  and the recipe's own style template. */
export interface ApplyChoices {
  /** A `PLOT_TEMPLATES` value used INSTEAD of the recipe's own
   *  `visual.plotTemplate`, for this apply only; null/absent keeps it. */
  styleTemplate?: string | null;
  /** A saved transformation recipe (Pipeline analysis template, P2.5) to run
   *  on the dataset FIRST; the Plot Recipe is then applied to its output. */
  transformName?: string | null;
}

/** The status suffix naming a recipe's recorded excluded-row policy when it
 *  differs from the current app-wide preference; "" when it matches or was
 *  never recorded. Reported, never applied (see `RecipeOutlierPolicy`). */
export function outlierPolicyNote(policy: PlotRecipe["outlierPolicy"], current: "hide" | "grey"): string {
  if (!policy || policy.excludedDisplay === current) return "";
  const saved = policy.excludedDisplay === "grey" ? "greyed" : "hidden";
  return `it was saved with excluded rows ${saved}; Preferences › Excluded rows is set to ${current === "grey" ? "Grey" : "Hide"}`;
}

/** One sentence describing where a recipe's preview came from -- its
 *  thumbnail's tooltip. Names only what the recipe actually recorded. */
export function recipeSummary(r: PlotRecipe): string {
  const parts = [`Saved from “${r.provenance.sourceDatasetLabel || "an unnamed dataset"}”`];
  if (r.outlierPolicy) parts.push(`excluded rows ${r.outlierPolicy.excludedDisplay === "grey" ? "greyed" : "hidden"}`);
  if (r.transform) parts.push(`after transformation “${r.transform.name}” (r${r.transform.revision})`);
  return `${parts.join(", ")}.`;
}

/** The Transform picker's pre-selection for `recipe` (F4.2c owner decision
 *  (c), "Pre-select but also easy override"): the transformation the recipe
 *  recorded when one of that name is still saved, else none (""). `missing`
 *  names a recorded transformation that is no longer saved, for the
 *  one-sentence note beside the picker. */
export function recordedTransformChoice(
  recipe: PlotRecipe,
  saved: readonly { name: string }[],
): { value: string; missing: string | null } {
  const rec = recipe.transform;
  if (!rec) return { value: "", missing: null };
  return saved.some((t) => t.name === rec.name) ? { value: rec.name, missing: null } : { value: "", missing: rec.name };
}

type HistoryState = Pick<ReturnType<typeof useApp.getState>, "history" | "future" | "activeId">;

/** F4.2c owner decision (b), "Rejection with notice": take back a
 *  transformation run whose output the Plot Recipe then refused (or failed
 *  to plot). Removes exactly the datasets that run created, never a
 *  before/after diff. When nothing else was recorded since the run's own
 *  undo entry, undo and redo go back to exactly what they were before the
 *  gesture; otherwise the removed datasets are scrubbed out of every entry,
 *  so no undo or redo can bring them back. */
function takeBackTransform(created: readonly string[], before: HistoryState): void {
  useApp.setState((s) => {
    const had = new Set(before.history.map((e) => e.seq));
    const top = s.history[s.history.length - 1];
    const onlyOurs = top !== undefined && !had.has(top.seq) && s.future.length === 0 && s.history.slice(0, -1).every((e) => had.has(e.seq));
    const patch = removeDatasetsPatch(s, created);
    const keepActive = before.activeId !== null && (patch.datasets ?? s.datasets).some((d) => d.id === before.activeId);
    return {
      ...patch,
      ...(onlyOurs ? { history: before.history, future: before.future } : scrubDatasetsFromHistory(s, created)),
      ...(keepActive ? { activeId: before.activeId } : {}),
    };
  });
}

/** `applyRecipeToDataset` with the apply-time choices. The transformation
 *  runs through the Pipeline's own `applyRecipe` (preflight, rebinding by
 *  column name, provenance, one undo step, rollback on failure) and creates
 *  a NEW dataset; the source and the saved Plot Recipe are never modified.
 *  Throws, creating nothing, when the transformation is gone or refuses the
 *  dataset -- the caller's inline error line shows the message. With a
 *  transformation the gesture is TWO undo steps (the Pipeline apply's own,
 *  then the figure). If the Plot Recipe then REFUSES the output (or its
 *  apply throws), the transformation is taken back (`takeBackTransform`)
 *  and this throws a notice naming the recipe's reason; a staged preview
 *  keeps the output, since the dialog it opens plots it. */
export async function applyRecipeWithChoices(recipe: PlotRecipe, datasetId: string, choices: ApplyChoices): Promise<boolean> {
  let target = datasetId;
  let takeBack: (() => void) | null = null;
  if (choices.transformName) {
    const name = choices.transformName;
    const [{ loadTemplates }, { defaultBindings }, { applyRecipe }] = await Promise.all([
      import("../../../lib/template"),
      import("../../../lib/recipePreflight"),
      import("../pipeline/runTemplate"),
    ]);
    const template = loadTemplates().find((t) => t.name === name);
    if (!template) throw new Error(`transformation “${name}” is no longer saved`);
    const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
    if (!ds) throw new Error("that dataset is no longer loaded");
    const bindings = defaultBindings(template.expects?.columns ?? [], ds.data);
    const { history, future, activeId } = useApp.getState();
    const [result] = await applyRecipe(template, [{ datasetId, bindings }], { ackUnits: false });
    if (result?.status !== "ok" || !result.outputId) {
      throw new Error(`transformation “${name}” did not run: ${result?.note ?? "no result"}`);
    }
    target = result.outputId;
    const created = result.created ?? [target];
    takeBack = () => takeBackTransform(created, { history, future, activeId });
  }
  const style = choices.styleTemplate;
  const chosen = style && style !== recipe.visual.plotTemplate ? { ...recipe, visual: { ...recipe.visual, plotTemplate: style } } : recipe;
  const pendingBefore = useApp.getState().pendingRecipeApplication;
  let ok: boolean;
  try {
    ok = await applyRecipeToDataset(chosen, target);
  } catch (e) {
    takeBack?.();
    throw e;
  }
  if (!ok && takeBack && useApp.getState().pendingRecipeApplication === pendingBefore) {
    takeBack();
    const notice = `${useApp.getState().status} — the output of transformation “${choices.transformName}” was removed.`;
    useApp.setState({ status: notice });
    throw new Error(notice);
  }
  const note = ok ? outlierPolicyNote(recipe.outlierPolicy, useApp.getState().excludedDisplay) : "";
  if (note) useApp.setState((s) => ({ status: `${s.status} — ${note}` }));
  return ok;
}

/** Trigger a browser download of `recipe` as a standalone `.json` file. */
export function exportRecipe(recipe: PlotRecipe): void {
  saveBlob(
    new Blob([exportRecipeFile(recipe)], { type: "application/json" }),
    `${recipe.name.replace(/[^A-Za-z0-9._-]/g, "_")}.qzrecipe.json`,
  );
}

/** Parse+import `text` (a picked file's contents) into `scope`, returning the
 *  LANDED recipe's id. Throws `importRecipeFile`'s own message verbatim on
 *  malformed input -- the caller surfaces it, this function does not swallow
 *  it (there is no sane default for a file the user explicitly chose, same
 *  contract `importRecipeFile` itself states). Delegates the actual
 *  insertion to each scope's own copy-in action (`copyPlotRecipeIn`/
 *  `copyIn`) -- the SAME fresh-id + deduped-name + (for global) hydrate-first
 *  guard (finding 5) `copyRecipeToOtherScope` uses, rather than a third
 *  hand-rolled insertion with its own chance to drift. `importRecipeFile`
 *  already mints its own fresh id; minting a SECOND one here (P3.5: this is
 *  the id the caller gets back, so a library-level import can focus the new
 *  row) is harmless -- still unique -- and keeps this a plain,
 *  un-special-cased call into the shared seam. */
export function importRecipeToScope(scope: RecipeScope, text: string): string {
  const recipe = importRecipeFile(text); // throws on malformed
  return scope === "project" ? useApp.getState().copyPlotRecipeIn(recipe) : useGlobalPlotRecipes.getState().copyIn(recipe);
}

/** "Editing" a built-in Plot Recipe (`lib/builtinPlotRecipes.ts`'s READ-ONLY
 *  note) lands a normal, fully-editable PROJECT recipe -- the same
 *  `copyPlotRecipeIn` seam `copyRecipeToOtherScope` above uses, one undo
 *  step, the built-in itself never touched. Routed through THIS module
 *  (never called directly on the store from `RecipeManagerPanel.tsx`) per
 *  THAT file's own header: "all cross-store orchestration lives in
 *  recipeManagerActions.ts, this file is the thin view."
 *
 *  FINDING 7 (code-review): the copy is flagged `noAutoSuggest: true` (a
 *  new additive `PlotRecipe` field, `lib/plotRecipeSchema.ts`) BEFORE it
 *  ever reaches the project list. Without this, the copy is an ORDINARY
 *  project recipe to `store/plotRecipeApply.ts`'s `resolvedCandidates` --
 *  the moment its technique/labels line up with a freshly imported dataset,
 *  it would resurface as an automatic suggestion (`matchingPlotRecipes` /
 *  the post-import toast), silently contradicting "built-ins are never
 *  offered automatically" (`lib/builtinPlotRecipes.ts`'s own module doc) the
 *  instant a person did the one thing the panel invites them to do with a
 *  built-in. The flag excludes it from that ONE surface only -- it still
 *  applies manually, exactly like any other project recipe, and Rename/
 *  Duplicate/Delete/Export all work on it normally.
 *
 *  Sets `status` as the copy's confirmation -- the same app-wide status
 *  line every other recipe action's caller (and `StatusBar.tsx`) reads, so
 *  the gesture isn't silent. */
export function copyBuiltinToProject(recipe: PlotRecipe): string {
  const id = useApp.getState().copyPlotRecipeIn({ ...recipe, noAutoSuggest: true });
  useApp.setState({ status: `copied "${recipe.name}" to Project (won't be auto-suggested)` });
  return id;
}
