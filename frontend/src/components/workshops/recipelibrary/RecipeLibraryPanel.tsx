// P3.5 slice 2 — browse-first UI over the common recipe contract. This view
// deliberately does not mutate any recipe format: favorites/tags live in the
// sidecar index, and advanced Plot Recipe operations stay in their existing
// manager until the operation layer reaches parity across all six kinds.

import { useEffect, useRef, useState } from "react";

import { setFavorite, setTags } from "../../../lib/recipeIndex";
import { RECIPE_KIND_LABEL, RECIPE_KINDS, type RecipeDescriptor, type RecipeKind } from "../../../lib/recipeLibrary";
import { collectRecipes } from "../../../lib/recipeSources";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useRecipeManager } from "../../../store/recipeManager";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Checkbox } from "../../primitives/Checkbox";
import { Button, Select } from "../../primitives";

type KindFilter = "all" | RecipeKind;

function sortRows(rows: readonly RecipeDescriptor[]): RecipeDescriptor[] {
  return [...rows].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    const recent = (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "");
    return recent || a.name.localeCompare(b.name);
  });
}

function RecipeRow({ row, refresh }: { row: RecipeDescriptor; refresh: () => void }) {
  const [editingTags, setEditingTags] = useState(false);
  const [tagText, setTagText] = useState(row.tags.join(", "));
  const skipBlurCommit = useRef(false);

  const commitTags = (): void => {
    setTags(row.ref, tagText.split(","));
    setEditingTags(false);
    refresh();
  };

  return (
    <li className="qz-recipe-library-row">
      <button
        className="qz-recipe-favorite"
        aria-label={`${row.favorite ? "Remove" : "Add"} ${row.name} ${row.favorite ? "from" : "to"} favorites`}
        aria-pressed={row.favorite}
        title={row.favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={() => { setFavorite(row.ref, !row.favorite); refresh(); }}
      >
        {row.favorite ? "★" : "☆"}
      </button>
      <div className="qz-recipe-library-main">
        <div className="qz-recipe-library-title">
          <span title={row.name}>{row.name}</span>
          <span className="qz-recipe-badge">{RECIPE_KIND_LABEL[row.kind]}</span>
          <span className="qz-recipe-badge">{row.ref.scope === "project" ? "This project" : "Global"}</span>
        </div>
        <div className="qz-recipe-library-summary">
          {row.summary ?? "Saved recipe"}
          {row.technique ? ` · ${row.technique}` : ""}
          {row.lastUsedAt ? ` · used ${new Date(row.lastUsedAt).toLocaleDateString()}` : ""}
        </div>
        {editingTags ? (
          <input
            autoFocus
            className="qz-recipe-tag-input"
            aria-label={`Tags for ${row.name}`}
            value={tagText}
            placeholder="xrd, publication, routine"
            onChange={(e) => setTagText(e.target.value)}
            onBlur={() => {
              if (skipBlurCommit.current) {
                skipBlurCommit.current = false;
                return;
              }
              commitTags();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTags();
              if (e.key === "Escape") {
                skipBlurCommit.current = true;
                setEditingTags(false);
                setTagText(row.tags.join(", "));
              }
              e.stopPropagation();
            }}
          />
        ) : (
          <button className="qz-recipe-tags" onClick={() => setEditingTags(true)}>
            {row.tags.length ? row.tags.map((tag) => `#${tag}`).join("  ") : "+ Add tags"}
          </button>
        )}
      </div>
    </li>
  );
}

export default function RecipeLibraryPanel() {
  const close = useRecipeManager((s) => s.closeRecipeManager);
  const openPlotManager = useRecipeManager((s) => s.openRecipeManager);
  const projectPlots = useApp((s) => s.plotRecipes);
  const quickPlots = useApp((s) => s.quickPlotTemplates);
  const globalPlots = useGlobalPlotRecipes((s) => s.recipes);
  const globalHydrated = useGlobalPlotRecipes((s) => s.hydrated);
  const hydrateGlobal = useGlobalPlotRecipes((s) => s.hydrate);
  const [kind, setKind] = useState<KindFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [, setRevision] = useState(0);

  useEffect(() => hydrateGlobal(), [hydrateGlobal]);

  const collection = collectRecipes({
    plotProject: projectPlots,
    plotGlobal: globalPlots,
    quickPlot: quickPlots,
    plotSourcesComplete: globalHydrated,
  });

  const rows = sortRows(collection.recipes).filter((row) =>
    (kind === "all" || row.kind === kind) && (!favoritesOnly || row.favorite),
  );

  return (
    <ToolWindow id="recipe-library" title="Recipe Library" width={620} onClose={close}>
      <div className="qz-recipe-library-toolbar">
        <Select
          aria-label="Recipe type"
          value={kind}
          onChange={(e) => setKind(e.target.value as KindFilter)}
          options={[
            { value: "all", label: "All recipe types" },
            ...RECIPE_KINDS.map((value) => ({ value, label: RECIPE_KIND_LABEL[value] })),
          ]}
        />
        <Checkbox checked={favoritesOnly} onChange={setFavoritesOnly}>
          Favorites only
        </Checkbox>
        <span className="qz-recipe-library-count">{rows.length} of {collection.recipes.length}</span>
        <Button size="sm" onClick={() => openPlotManager()}>Manage Plot Recipes…</Button>
      </div>

      {!collection.complete && (
        <div className="qz-recipe-library-warning" role="status">
          Some recipe sources could not be read completely. Available recipes are shown; cleanup is paused.
        </div>
      )}

      {collection.recipes.length === 0 ? (
        <div className="qz-recipe-library-empty">
          <strong>No saved recipes yet</strong>
          <span>Save a plot, Quick Plot setup, analysis, peak setup, graph style, or fit model to find it here.</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="qz-recipe-library-empty">No recipes match these filters.</div>
      ) : (
        <ul className="qz-recipe-library-list">
          {rows.map((row) => <RecipeRow key={`${row.ref.kind}:${row.ref.scope}:${row.ref.id}`} row={row} refresh={() => setRevision((n) => n + 1)} />)}
        </ul>
      )}
    </ToolWindow>
  );
}
