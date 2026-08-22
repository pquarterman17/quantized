// Recipe Manager panel (P1.3 wave 3, Lane D deliverable 3): lists every Plot
// Recipe across BOTH scopes (project + global, store/plotRecipes.ts /
// store/globalPlotRecipes.ts), with per-row rename/duplicate/delete,
// move-between-scopes, export-to-file, apply-to-a-chosen-dataset, plus
// import-from-file into either scope. Mirrors QuickPlotWithDialog's row
// layout (inline rename, size="sm" action buttons) rather than inventing a
// new one; all cross-store orchestration lives in recipeManagerActions.ts,
// this file is the thin view.

import { useEffect, useRef, useState } from "react";

import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useRecipeManager } from "../../../store/recipeManager";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import {
  applyRecipeToDataset,
  combinedRecipeRows,
  deleteRecipe,
  duplicateRecipe,
  exportRecipe,
  importRecipeToScope,
  moveRecipeScope,
  renameRecipe,
  type RecipeScope,
} from "./recipeManagerActions";

const SCOPE_LABEL: Record<RecipeScope, string> = { project: "Project", global: "Global" };

export default function RecipeManagerPanel() {
  const close = useRecipeManager((s) => s.closeRecipeManager);
  const projectRecipes = useApp((s) => s.plotRecipes);
  const globalRecipes = useGlobalPlotRecipes((s) => s.recipes);
  const hydrateGlobal = useGlobalPlotRecipes((s) => s.hydrate);
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);

  const [datasetId, setDatasetId] = useState(activeId ?? datasets[0]?.id ?? "");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const projectImportRef = useRef<HTMLInputElement>(null);
  const globalImportRef = useRef<HTMLInputElement>(null);

  // Defensive re-hydrate: App.tsx's boot effect already loads the global list
  // once (see store/globalPlotRecipes.ts's header), but `hydrate()` itself is
  // idempotent (guarded by `hydrated`), so a second call here is a harmless
  // no-op in the normal running app and a correctness net for any test/entry
  // path that renders this panel without going through that boot effect.
  useEffect(() => {
    hydrateGlobal();
  }, [hydrateGlobal]);

  const rows = combinedRecipeRows(projectRecipes, globalRecipes);

  const commitRename = (id: string): void => {
    const row = rows.find((r) => r.recipe.id === id);
    if (row) renameRecipe(row.scope, id, renameValue);
    setRenamingId(null);
  };

  const runImport = (scope: RecipeScope, file: File): void => {
    void file.text().then((text) => {
      try {
        importRecipeToScope(scope, text);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "import failed");
      }
    });
  };

  const applyRow = (row: (typeof rows)[number]): void => {
    if (!datasetId) return;
    void applyRecipeToDataset(row.recipe, datasetId).then((ok) => {
      // Close on a clean apply OR once a preview+confirm has been staged for
      // it (PlotRecipeApplyDialog takes over from there) -- stay open only on
      // an outright refusal, so the user can try a different dataset.
      if (ok || useApp.getState().pendingRecipeApplication) close();
    });
  };

  return (
    <ToolWindow id="recipe-manager" title="Plot Recipe Manager" width={520} onClose={close}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <label className="qzk-field-lbl">Apply to</label>
        <Select
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

      {rows.length === 0 ? (
        <div style={{ color: "var(--text-faint)" }}>
          No saved Plot Recipes yet. Use “Save as Plot Recipe…” on a plot window to create one.
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
          {rows.map((row) => (
            <li key={`${row.scope}:${row.recipe.id}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="qz-shortcut" style={{ width: 52, flexShrink: 0 }}>{SCOPE_LABEL[row.scope]}</span>
              {renamingId === row.recipe.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  aria-label={`Rename ${row.recipe.name}`}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(row.recipe.id);
                    if (e.key === "Escape") setRenamingId(null);
                    e.stopPropagation();
                  }}
                  onBlur={() => commitRename(row.recipe.id)}
                  style={{ flex: 1 }}
                />
              ) : (
                <span className="qzk-menu-trunc" style={{ flex: 1 }} title={row.recipe.name}>
                  {row.recipe.name}
                </span>
              )}
              <Button size="sm" disabled={!datasetId} onClick={() => applyRow(row)}>
                Apply
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setRenamingId(row.recipe.id);
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
                title={row.scope === "project" ? "Move to Global" : "Move to Project"}
                onClick={() => moveRecipeScope(row.scope, row.recipe.id)}
              >
                {row.scope === "project" ? "→ Global" : "→ Project"}
              </Button>
              <Button size="sm" onClick={() => exportRecipe(row.recipe)}>
                Export
              </Button>
              <Button size="sm" variant="danger" onClick={() => deleteRecipe(row.scope, row.recipe.id)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 8 }}>
          {error}
        </div>
      )}
    </ToolWindow>
  );
}
