// P3.5 slice 2 — browse-first UI over the common recipe contract. This view
// deliberately does not mutate any recipe format: favorites/tags live in the
// sidecar index, and advanced Plot Recipe operations stay in their existing
// manager until the operation layer reaches parity across all six kinds.

import { useEffect, useRef, useState } from "react";

import { pruneEntries, setFavorite, setTags } from "../../../lib/recipeIndex";
import {
  RECIPE_KIND_LABEL,
  RECIPE_KINDS,
  supportsOperation,
  type RecipeDescriptor,
  type RecipeKind,
} from "../../../lib/recipeLibrary";
import { collectRecipes, liveKeys } from "../../../lib/recipeSources";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useRecipeManager } from "../../../store/recipeManager";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import RecipeRowActions from "./RecipeRowActions";
import { renameRecipe, type ActionResult } from "./recipeActions";
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

function RecipeRow({
  row,
  refresh,
  onResult,
}: {
  row: RecipeDescriptor;
  /** Re-render the panel. ONE mechanism serves both a sidecar change and a
   *  change to a recipe system itself, because `collectRecipes` is called on
   *  every render and re-reads every source — so a re-render IS a re-read.
   *  (If that is ever memoized, this needs to split in two.) */
  refresh: () => void;
  onResult: (result: ActionResult) => void;
}) {
  const [editingTags, setEditingTags] = useState(false);
  const [tagText, setTagText] = useState(row.tags.join(", "));
  const [editingName, setEditingName] = useState(false);
  const [nameText, setNameText] = useState(row.name);
  const skipBlurCommit = useRef(false);

  const commitTags = (): void => {
    setTags(row.ref, tagText.split(","));
    setEditingTags(false);
    refresh();
  };

  const commitName = (): void => {
    setEditingName(false);
    if (nameText.trim() === row.name) return; // nothing to do, and no toast for it
    const result = renameRecipe(row.ref, nameText);
    onResult(result);
    if (result.ok) refresh();
    else setNameText(row.name); // a refusal leaves the row showing the truth
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
          {editingName ? (
            <input
              autoFocus
              className="qz-recipe-name-input"
              aria-label={`Rename ${row.name}`}
              value={nameText}
              onChange={(e) => setNameText(e.target.value)}
              onBlur={() => {
                if (skipBlurCommit.current) {
                  skipBlurCommit.current = false;
                  return;
                }
                commitName();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") {
                  // Same blur-vs-Escape ordering the tag editor uses: Escape
                  // fires before blur, so it must suppress the blur commit or
                  // cancelling would save.
                  skipBlurCommit.current = true;
                  setEditingName(false);
                  setNameText(row.name);
                }
                e.stopPropagation();
              }}
            />
          ) : supportsOperation(row.kind, "rename") ? (
            <button
              className="qz-recipe-library-name"
              // The visible text is the recipe name, which alone says nothing
              // about what the button DOES. The label keeps the visible text
              // as a prefix so voice control still matches what is on screen
              // (WCAG 2.5.3, label in name).
              aria-label={`Rename ${row.name}`}
              title={`Rename ${row.name}`}
              onClick={() => { setNameText(row.name); setEditingName(true); }}
            >
              {row.name}
            </button>
          ) : (
            <span className="qz-recipe-library-name" title={row.name}>{row.name}</span>
          )}
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
      <RecipeRowActions row={row} onChanged={refresh} onResult={onResult} />
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
  const globalComplete = useGlobalPlotRecipes((s) => s.complete);
  // The workspace-backed half of `plotSourcesComplete` (P3.5): `plotRecipes`
  // and `quickPlotTemplates` are sanitized at project load, and until this
  // existed nothing downstream could tell a load that dropped records from a
  // clean one — only the global slot vouched for itself.
  const workspaceComplete = useApp((s) => s.recipeSourcesComplete);
  const hydrateGlobal = useGlobalPlotRecipes((s) => s.hydrate);
  const [kind, setKind] = useState<KindFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [, setRevision] = useState(0);
  // One shared line for every action outcome, success or refusal. A refusal
  // here is ordinary ("select a dataset first", "that recipe no longer
  // exists"), not an error worth a modal.
  const [result, setResult] = useState<ActionResult | null>(null);

  useEffect(() => hydrateGlobal(), [hydrateGlobal]);

  const collection = collectRecipes({
    plotProject: projectPlots,
    plotGlobal: globalPlots,
    quickPlot: quickPlots,
    plotSourcesComplete: globalHydrated && globalComplete && workspaceComplete,
  });

  // P3.5: drop sidecar metadata for recipes that no longer exist — the only
  // thing keeping `qz.recipeIndex` from growing forever as recipes come and go.
  //
  // Gated twice, and both gates matter. `collection.complete` is the one
  // `pruneEntries` itself demands: every source reader returns [] both for
  // "empty" and for "the read failed", so pruning against a failed read would
  // delete every favorite the user has.
  //
  // Depending on `liveSignature` rather than on `collection` is the second.
  // This component recomputes the collection on every render (each favorite or
  // tag toggle bumps `revision`), so depending on the object would re-run this
  // on every click. That is a READ storm, not a write one — `pruneEntries`
  // writes only when it actually drops something — but it still parses and
  // sanitizes the whole index per render for nothing. The signature changes
  // only when the SET of live recipes does, which is the only time there is
  // anything to prune. Measured: one favorite toggle costs 2 index reads with
  // the signature dependency and 3 with the object, which is what the
  // regression in RecipeLibraryPanel.test.tsx pins.
  const live = liveKeys(collection);
  const liveSignature = [...live].sort().join("\u0000");
  const liveRef = useRef(live);
  liveRef.current = live;
  const complete = collection.complete;
  useEffect(() => {
    if (!complete) return;
    pruneEntries(liveRef.current, true);
  }, [complete, liveSignature]);

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

      {result && (
        <div
          className={result.ok ? "qz-recipe-library-result" : "qz-recipe-library-result qz-is-refused"}
          role="status"
        >
          {result.ok ? result.message : result.reason}
        </div>
      )}

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
          {rows.map((row) => (
            <RecipeRow
              key={`${row.ref.kind}:${row.ref.scope}:${row.ref.id}`}
              row={row}
              refresh={() => setRevision((n) => n + 1)}
              onResult={setResult}
            />
          ))}
        </ul>
      )}
    </ToolWindow>
  );
}
