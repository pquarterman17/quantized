// Recipe Manager panel (P1.3 wave 3, Lane D deliverable 3): lists every Plot
// Recipe across BOTH scopes (project + global, store/plotRecipes.ts /
// store/globalPlotRecipes.ts), with per-row rename/duplicate/delete,
// copy-to-other-scope, export-to-file, apply-to-a-chosen-dataset, plus
// import-from-file into either scope. Mirrors QuickPlotWithDialog's row
// layout (inline rename, size="sm" action buttons) rather than inventing a
// new one; all cross-store orchestration lives in recipeManagerActions.ts,
// this file is the thin view.
//
// ORCHESTRATOR RULING B (code-review findings 2+3): the cross-scope button
// COPIES (never moves) -- its title text says so, and points at Delete as
// the explicit way to finish a "move" (delete the source afterward).
//
// FINDING 3 (code-review), belt-and-braces: `renamingKey`/`commitRename`
// below are keyed by `${scope}:${id}` -- the SAME composite the `<li>` key
// uses -- not by id alone, so two rows that happen to share an id across
// scopes (legacy data, or any future edge case) can never cross-wire their
// rename inputs.
//
// FINDING 2/5 (final code-review round): `applyRow` below carries a
// per-PANEL in-flight guard (finding 2 -- a rapid double-click must not
// create two figures) and captures `pendingRecipeApplication` BEFORE
// calling apply, comparing it by IDENTITY against the post-apply value
// (finding 5 -- the manager can open over an ALREADY-staged preview+confirm
// dialog, and a refused apply never touches that pre-existing pending, so a
// bare truthiness check can't tell "mine" from "someone else's").
//
// F4.2 / audit P1.3: every row shows the recipe's captured preview
// (RecipeThumbnail), and the second toolbar row holds the style template
// for this apply (default: the recipe's own). The saved transformation to
// run first is picked PER ROW (RecipeTransformPicker, F4.2c owner decision
// (c)): it starts on the one the recipe recorded when that is still saved,
// else None. Both are per-gesture picks that never edit the saved recipe;
// see `applyRecipeWithChoices`.

import { useEffect, useRef, useState } from "react";

import { BUILTIN_PLOT_RECIPES } from "../../../lib/builtinPlotRecipes";
import type { PlotRecipe } from "../../../lib/plotRecipe";
import { previewGlyph } from "../../../lib/plotRecipePreview";
import { PLOT_TEMPLATES } from "../../../lib/plotTemplates";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useRecipeManager } from "../../../store/recipeManager";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { RecipeThumbnail } from "./RecipeThumbnail";
import { RecipeTransformPicker } from "./RecipeTransformPicker";
import { useSavedTransforms } from "./useSavedTransforms";
import {
  applyRecipeWithChoices,
  combinedRecipeRows,
  copyBuiltinToProject,
  copyRecipeToOtherScope,
  deleteRecipe,
  duplicateRecipe,
  exportRecipe,
  importRecipeToScope,
  recipeSummary,
  recordedTransformChoice,
  renameRecipe,
  type RecipeScope,
} from "./recipeManagerActions";

/** `${scope}:${id}` -- the same composite the row `<li>` key uses (finding 3). */
const rowKey = (scope: RecipeScope, id: string): string => `${scope}:${id}`;

const SCOPE_LABEL: Record<RecipeScope, string> = { project: "Project", global: "Global" };

// A row is its action line plus, when there is one, its Transform picker.
const ROW_STYLE = { display: "grid", gap: 2 } as const;
const LINE_STYLE = { display: "flex", alignItems: "center", gap: 6 } as const;

export default function RecipeManagerPanel() {
  const close = useRecipeManager((s) => s.closeRecipeManager);
  const projectRecipes = useApp((s) => s.plotRecipes);
  const globalRecipes = useGlobalPlotRecipes((s) => s.recipes);
  const hydrateGlobal = useGlobalPlotRecipes((s) => s.hydrate);
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);

  const [pickedDatasetId, setDatasetId] = useState(activeId ?? datasets[0]?.id ?? "");
  // A picked dataset that has since been deleted falls back like the initial
  // pick, so the select never shows (or applies to) a vanished dataset.
  const datasetId = datasets.some((d) => d.id === pickedDatasetId)
    ? pickedDatasetId
    : (activeId ?? datasets[0]?.id ?? "");
  // Apply-time choices (F4.2): "" = the recipe's own style template. The
  // transformation is per row: `transformPick` holds only the rows the user
  // overrode (keyed like the rows); every other row uses the recipe's
  // recorded one (`recordedTransformChoice`). The saved list stays live
  // (`useSavedTransforms`): the Pipeline workshop saves into it while this
  // window is open.
  const [styleTemplate, setStyleTemplate] = useState("");
  const [transformPick, setTransformPick] = useState<Record<string, string>>({});
  const transforms = useSavedTransforms();
  // Finding 3, belt-and-braces: keyed by `${scope}:${id}` (rowKey), not id
  // alone -- see the module doc.
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const projectImportRef = useRef<HTMLInputElement>(null);
  const globalImportRef = useRef<HTMLInputElement>(null);
  // FINDING 2 (code-review): a per-PANEL in-flight guard, not per-row --
  // `applyRow`'s only synchronous checks used to be `datasetId`/refusal, so
  // two rapid clicks (even on two DIFFERENT rows) both pass them before
  // either await on the apply path's dynamic chunk load resolves, landing
  // TWO figures from what should read as one gesture. `applyingRef` is the
  // actual bail check (belt) -- synchronous, so it closes the window a
  // same-tick second click could slip through before React re-renders the
  // `disabled` prop (braces) that blocks the ordinary double-click case.
  const applyingRef = useRef(false);
  const [applying, setApplying] = useState(false);

  // Defensive re-hydrate: App.tsx's boot effect already loads the global list
  // once (see store/globalPlotRecipes.ts's header), but `hydrate()` itself is
  // idempotent (guarded by `hydrated`), so a second call here is a harmless
  // no-op in the normal running app and a correctness net for any test/entry
  // path that renders this panel without going through that boot effect.
  useEffect(() => {
    hydrateGlobal();
  }, [hydrateGlobal]);

  const rows = combinedRecipeRows(projectRecipes, globalRecipes);

  const commitRename = (scope: RecipeScope, id: string): void => {
    renameRecipe(scope, id, renameValue);
    setRenamingKey(null);
  };

  // FINDING 8 (code-review): `file.text()` itself can reject (a read error),
  // not just resolve with malformed content -- the `.catch` here routes that
  // into the SAME inline error surface `importRecipeToScope`'s own throw
  // already uses, instead of becoming an unhandled promise rejection.
  const runImport = (scope: RecipeScope, file: File): void => {
    void file
      .text()
      .then((text) => {
        importRecipeToScope(scope, text);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "import failed");
      });
  };

  // A row's transformation choice (its override, else the recorded one) and
  // its picker -- none when nothing is saved and nothing was recorded.
  const transformFor = (key: string, recipe: PlotRecipe) => {
    const { value: recorded, missing } = recordedTransformChoice(recipe, transforms);
    // An override of a since-deleted transformation reverts to the recorded one.
    const pick = transformPick[key];
    const value = pick !== undefined && (pick === "" || transforms.some((t) => t.name === pick)) ? pick : recorded;
    const picker =
      transforms.length > 0 || recipe.transform ? (
        <RecipeTransformPicker
          recipe={recipe}
          transforms={transforms}
          value={value}
          missing={missing}
          onChange={(v) => setTransformPick((p) => ({ ...p, [key]: v }))}
        />
      ) : null;
    return { value, picker };
  };

  // Takes the bare `PlotRecipe` (not a `RecipeRow`) so the SAME apply
  // gesture -- and the SAME finding 2/5 guards -- serve the project/global
  // rows below AND the read-only "Built-in" group's rows, which have no
  // `RecipeRow`/scope of their own (store/plotRecipeApply.ts's
  // `applyPlotRecipeObject`, which `applyRecipeToDataset` calls, never
  // depends on the recipe being a member of either live list -- see its own
  // doc). `transformName` is that row's Transform choice.
  const applyRow = (recipe: PlotRecipe, transformName: string): void => {
    if (!datasetId || applyingRef.current) return; // finding 2: bail while an apply is already in flight
    applyingRef.current = true;
    setApplying(true);
    setError(null);
    // FINDING 5 (code-review, prior round): captured BEFORE the apply -- the
    // manager can open OVER an already-staged preview+confirm dialog (e.g.
    // via the palette), and a REFUSED apply never touches
    // `pendingRecipeApplication` at all, leaving that pre-existing one
    // sitting there. Comparing the post-apply value against THIS captured
    // snapshot (by identity, not just truthiness) is what tells "this apply
    // just staged something new" apart from "there was already one there
    // that isn't mine".
    const pendingBefore = useApp.getState().pendingRecipeApplication;
    void applyRecipeWithChoices(recipe, datasetId, { styleTemplate, transformName })
      .then((ok) => {
        const pendingAfter = useApp.getState().pendingRecipeApplication;
        // Close on a clean apply OR once a preview+confirm has been staged for
        // THIS gesture (PlotRecipeApplyDialog takes over from there) -- stay
        // open on an outright refusal (even with an unrelated pending still
        // sitting there), so the user can try a different dataset.
        if (ok || (pendingAfter !== null && pendingAfter !== pendingBefore)) close();
      })
      .catch((e: unknown) => {
        // FINDING 5 (this round, code-review): the apply path lazy-loads its
        // matcher/capture chunk (`store/plotRecipeApplyLazy.ts`) -- a failed
        // fetch rejects this promise, and without a `.catch` the click did
        // nothing visible while the rejection escaped unhandled. Surfaced
        // through the SAME inline error line `runImport`'s own failure
        // above uses, rather than a bespoke toast.
        setError(e instanceof Error ? e.message : "could not apply that plot recipe");
      })
      .finally(() => {
        // Runs on every path -- success, refusal, staged, AND a rejected
        // chunk load -- so `applying`/`applyingRef` can never get stuck
        // `true` forever the way a `.then`-only chain left them before.
        applyingRef.current = false;
        setApplying(false);
      });
  };

  return (
    <ToolWindow id="recipe-manager" title="Plot Recipe Manager" width={600} onClose={close}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <label className="qzk-field-lbl">Apply to</label>
        <Select
          aria-label="Apply to dataset"
          options={[
            { value: "", label: "pick a dataset…" },
            ...datasets.map((d) => ({ value: d.id, label: d.name })),
          ]}
          value={datasetId}
          onChange={(e) => setDatasetId(e.target.value)}
        />
        <span style={{ flex: 1 }} />
        <Button size="sm" onClick={() => projectImportRef.current?.click()}>
          Import to Project…
        </Button>
        <Button size="sm" onClick={() => globalImportRef.current?.click()}>
          Import to Global…
        </Button>
        <input
          ref={projectImportRef}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) runImport("project", f);
            e.target.value = "";
          }}
        />
        <input
          ref={globalImportRef}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) runImport("global", f);
            e.target.value = "";
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <label className="qzk-field-lbl">Style</label>
        <Select
          aria-label="Style template"
          title="Style template for this apply; the saved recipe keeps its own."
          options={[{ value: "", label: "Recipe's own" }, ...PLOT_TEMPLATES.map((t) => ({ value: t.value, label: t.label }))]}
          value={styleTemplate}
          onChange={(e) => setStyleTemplate(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <div style={{ color: "var(--text-faint)" }}>
          No saved Plot Recipes yet. Use “Save as Plot Recipe…” on a plot window to create one.
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
          {rows.map((row) => {
            const key = rowKey(row.scope, row.recipe.id);
            const otherScope: RecipeScope = row.scope === "project" ? "global" : "project";
            const transform = transformFor(key, row.recipe);
            return (
              <li key={key} style={ROW_STYLE}>
                <div style={LINE_STYLE}>
                  <span className="qz-shortcut" style={{ width: 52, flexShrink: 0 }}>{SCOPE_LABEL[row.scope]}</span>
                  <RecipeThumbnail preview={row.recipe.preview} label={row.recipe.name} summary={recipeSummary(row.recipe)} glyph={previewGlyph(row.recipe)} />
                  {renamingKey === key ? (
                    <input
                      autoFocus
                      value={renameValue}
                      aria-label={`Rename ${row.recipe.name}`}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(row.scope, row.recipe.id);
                        if (e.key === "Escape") setRenamingKey(null);
                        e.stopPropagation();
                      }}
                      onBlur={() => commitRename(row.scope, row.recipe.id)}
                      style={{ flex: 1 }}
                    />
                  ) : (
                    <span className="qzk-menu-trunc" style={{ flex: 1 }} title={row.recipe.name}>
                      {row.recipe.name}
                    </span>
                  )}
                  <Button size="sm" disabled={!datasetId || applying} onClick={() => applyRow(row.recipe, transform.value)}>
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setRenamingKey(key);
                      setRenameValue(row.recipe.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button size="sm" onClick={() => duplicateRecipe(row.scope, row.recipe.id)}>
                    Duplicate
                  </Button>
                  <Button
                    size="sm"
                    title={`Copy to ${SCOPE_LABEL[otherScope]} scope (the ${SCOPE_LABEL[row.scope]} original stays here -- delete it afterward to fully move it)`}
                    onClick={() => copyRecipeToOtherScope(row.scope, row.recipe.id)}
                  >
                    Copy to {SCOPE_LABEL[otherScope]}
                  </Button>
                  <Button size="sm" onClick={() => exportRecipe(row.recipe)}>
                    Export
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => deleteRecipe(row.scope, row.recipe.id)}>
                    Delete
                  </Button>
                </div>
                {transform.picker}
              </li>
            );
          })}
        </ul>
      )}

      {/* Built-in group (P2.1): a fixed, read-only set of technique-specific
          recipes shipped with the app -- see lib/builtinPlotRecipes.ts's
          module doc. Listed here, in the SAME picker every project/global
          recipe is applied from, but NEVER offered or applied automatically
          anywhere else (that module's own doc names the exact reason: its
          list is a member of neither live store `resolvedCandidates`
          reads). Apply + "Copy to Project" only -- no Rename/Duplicate/
          Delete/Export, since there is nothing in either store for those to
          act on; "Copy to Project" is the sanctioned way to edit one. */}
      <div className="qzk-ds-meta" style={{ marginTop: 12, marginBottom: 4 }}>Built-in</div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
        {BUILTIN_PLOT_RECIPES.map((recipe) => {
          const transform = transformFor(`builtin:${recipe.id}`, recipe);
          return (
            <li key={recipe.id} style={ROW_STYLE}>
              <div style={LINE_STYLE}>
                <span className="qz-shortcut" style={{ width: 52, flexShrink: 0 }}>Built-in</span>
                <RecipeThumbnail preview={recipe.preview} label={recipe.name} />
                <span className="qzk-menu-trunc" style={{ flex: 1 }} title={recipe.description || recipe.name}>
                  {recipe.name}
                </span>
                <Button size="sm" disabled={!datasetId || applying} onClick={() => applyRow(recipe, transform.value)}>
                  Apply
                </Button>
                <Button
                  size="sm"
                  title="Built-in recipes are read-only -- copy to Project to edit this one"
                  onClick={() => copyBuiltinToProject(recipe)}
                >
                  Copy to Project
                </Button>
              </div>
              {transform.picker}
            </li>
          );
        })}
      </ul>
      {error && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 8 }}>
          {error}
        </div>
      )}
    </ToolWindow>
  );
}
