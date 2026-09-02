// P3.5 slice 2 — browse-first UI over the common recipe contract. This view
// deliberately does not mutate any recipe format: favorites/tags live in the
// sidecar index, and advanced Plot Recipe operations stay in their existing
// manager until the operation layer reaches parity across all six kinds.

import { useCallback, useEffect, useRef, useState } from "react";
import { pruneEntries } from "../../../lib/recipeIndex";
import {
  RECIPE_KIND_LABEL,
  RECIPE_KINDS,
  type RecipeDescriptor,
  type RecipeKind,
} from "../../../lib/recipeLibrary";
import { collectRecipes, liveKeys, type RecipeSourceInput } from "../../../lib/recipeSources";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useRecipeManager } from "../../../store/recipeManager";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { RecipeRow, rowKey } from "./RecipeRow";
import { importAnyRecipe, type ActionResult } from "./recipeActions";
import { Checkbox } from "../../primitives/Checkbox";
import { Button, Select } from "../../primitives";
type KindFilter = "all" | RecipeKind;
/** Success, refusal, and the third state — needs-confirmation — are separated
 *  by more than colour: the text itself is prefixed ("Not done — …"), because
 *  a border tint alone fails WCAG 1.4.1 and several refusal strings come
 *  verbatim from the store and read like neutral status. */
function resultClass(result: ActionResult | null): string {
  if (result === null || result.ok) return "qz-recipe-library-result";
  return `qz-recipe-library-result ${result.pending ? "qz-is-pending" : "qz-is-refused"}`;
}
function sortRows(rows: readonly RecipeDescriptor[]): RecipeDescriptor[] {
  return [...rows].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    const recent = (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "");
    return recent || a.name.localeCompare(b.name);
  });
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
  // One in-flight operation across the whole list, including inline metadata
  // controls — see RecipeRowActions' prop doc.
  const [busy, setBusy] = useState(false);
  // Which row should take focus on its next mount. Lives HERE, not in the row,
  // because a rename can destroy the row that asked for it.
  const [focusRowKey, setFocusRowKey] = useState<string | null>(null);
  // Stable identity so the row's focus effect does not re-run every render.
  const clearFocusRow = useCallback(() => setFocusRowKey(null), []);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Hoisted to a variable (not just an inline `collectRecipes({...})` argument)
  // so the SAME snapshot can also be threaded down to each row for its
  // Details disclosure (`lib/recipeDetails.ts` needs it to locate a
  // workspace-backed record) — one read, two consumers, never two reads that
  // could disagree.
  const sourceInput: RecipeSourceInput = {
    plotProject: projectPlots,
    plotGlobal: globalPlots,
    quickPlot: quickPlots,
    plotSourcesComplete: globalHydrated && globalComplete && workspaceComplete,
  };

  useEffect(() => hydrateGlobal(), [hydrateGlobal]);

  const collection = collectRecipes(sourceInput);

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

  /** Drop a stale outcome when the thing it described is no longer on screen.
   *  "select a dataset first" sitting there after the user selected one, or
   *  "deleted — undo restores it" after they undid, is worse than silence. */
  const clearResult = (): void => setResult(null);

  /** The toolbar's "Import recipe…" file-picker handler. Sniffs the kind
   *  from the file's own content (`recipeFile.ts`) rather than asking the
   *  user, since a picked file already declares what it is. A plot recipe
   *  always lands in THIS PROJECT's scope here -- the row menu's "Copy to
   *  global" is the established way to move a recipe the other direction --
   *  so the success message says which scope it landed in; the four global
   *  kinds have only one scope, so theirs does not need to say so. */
  const runLibraryImport = (file: File): void => {
    void file
      .text()
      .then((text) => {
        const outcome = importAnyRecipe(text, "project");
        if (!outcome.ok) {
          setResult(outcome);
          return;
        }
        const landedRef = outcome.ref;
        if (!landedRef) {
          setResult(outcome); // defensive: every import path sets `ref` today
          return;
        }
        const name =
          landedRef.kind === "plot"
            ? (useApp.getState().plotRecipes.find((r) => r.id === landedRef.id)?.name ?? landedRef.id)
            : landedRef.id;
        setResult({
          ok: true,
          message: landedRef.kind === "plot" ? `imported "${name}" into this project` : `imported "${name}"`,
        });
        setRevision((n) => n + 1);
        setFocusRowKey(rowKey(landedRef));
      })
      .catch((e: unknown) => {
        // Mirrors RecipeManagerPanel's own handling: `file.text()` itself can
        // reject (a read error), not just resolve with malformed content.
        setResult({ ok: false, reason: e instanceof Error ? e.message : "could not read that file" });
      });
  };

  return (
    <ToolWindow id="recipe-library" title="Recipe Library" width={620} onClose={close}>
      <div className="qz-recipe-library-toolbar">
        <Select
          aria-label="Recipe type"
          value={kind}
          onChange={(e) => { clearResult(); setKind(e.target.value as KindFilter); }}
          options={[
            { value: "all", label: "All recipe types" },
            ...RECIPE_KINDS.map((value) => ({ value, label: RECIPE_KIND_LABEL[value] })),
          ]}
        />
        <Checkbox checked={favoritesOnly} onChange={(v) => { clearResult(); setFavoritesOnly(v); }}>
          Favorites only
        </Checkbox>
        <span className="qz-recipe-library-count">{rows.length} of {collection.recipes.length}</span>
        <Button size="sm" disabled={busy} onClick={() => importInputRef.current?.click()}>Import recipe…</Button>
        <Button size="sm" onClick={() => openPlotManager()}>Manage Plot Recipes…</Button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) runLibraryImport(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Mounted unconditionally and emptied when idle. A live region that is
          inserted ALREADY containing its text is unreliably announced (often
          not at all), which would have made the first outcome of a session —
          typically the "select a dataset first" refusal — silent. */}
      <div
        className={resultClass(result)}
        role="status"
        // Hidden from layout when empty, but never unmounted, so the region
        // exists before its content changes.
        hidden={result === null}
      >
        {result === null ? "" : result.ok ? result.message : `${result.pending ? "Needs confirmation" : "Not done"} — ${result.reason}`}
      </div>

      {!collection.complete && (
        // NOT a live region: it reflects the state of the load, does not change
        // while the panel is open, and role="status" on a never-changing node
        // announces nothing anyway.
        <div className="qz-recipe-library-warning">
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
              key={rowKey(row.ref)}
              row={row}
              sources={sourceInput}
              refresh={() => setRevision((n) => n + 1)}
              onResult={setResult}
              busy={busy}
              setBusy={setBusy}
              focusName={rowKey(row.ref) === focusRowKey}
              onFocusTaken={clearFocusRow}
              onRenamedTo={setFocusRowKey}
            />
          ))}
        </ul>
      )}
    </ToolWindow>
  );
}
