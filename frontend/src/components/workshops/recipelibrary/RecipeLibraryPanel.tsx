// P3.5 slice 2 — browse-first UI over the common recipe contract. This view
// deliberately does not mutate any recipe format: favorites/tags live in the
// sidecar index, and advanced Plot Recipe operations stay in their existing
// manager until the operation layer reaches parity across all six kinds.

import { useCallback, useEffect, useRef, useState } from "react";

import { pruneEntries, setFavorite, setTags } from "../../../lib/recipeIndex";
import {
  RECIPE_KIND_LABEL,
  RECIPE_KINDS,
  supportsOperation,
  type RecipeDescriptor,
  type RecipeKind,
  type RecipeRef,
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

/** The row's identity in the list. Also its React key, so a rename that
 *  changes the id necessarily REMOUNTS the row -- which is why focus
 *  restoration cannot live inside the row for the name-keyed kinds. */
export function rowKey(ref: RecipeRef): string {
  return `${ref.kind}:${ref.scope}:${ref.id}`;
}

function RecipeRow({
  row,
  refresh,
  onResult,
  busy,
  setBusy,
  focusName,
  onFocusTaken,
  onRenamedTo,
}: {
  row: RecipeDescriptor;
  /** Re-render the panel. ONE mechanism serves both a sidecar change and a
   *  change to a recipe system itself, because `collectRecipes` is called on
   *  every render and re-reads every source — so a re-render IS a re-read.
   *  (If that is ever memoized, this needs to split in two.) */
  refresh: () => void;
  onResult: (result: ActionResult) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  /** This row should take keyboard focus on its name control -- set by the
   *  panel after a rename, addressed by the ref the rename RETURNED. */
  focusName: boolean;
  onFocusTaken: () => void;
  /** Tell the panel which row key should hold focus after a rename. */
  onRenamedTo: (key: string) => void;
}) {
  const [editingTags, setEditingTags] = useState(false);
  const [tagText, setTagText] = useState(row.tags.join(", "));
  const [editingName, setEditingName] = useState(false);
  const [nameText, setNameText] = useState(row.name);
  // Reset on OPEN, not only consumed on blur. Removing a focused element fires
  // NO blur in any browser or in jsdom, so an Escape-cancel — which unmounts
  // the input — leaves this flag set and the NEXT click-away commit, in either
  // editor of this row, is silently swallowed. (The comment this replaces
  // claimed "Escape fires before blur"; it does not. Verified in review.)
  const skipBlurCommit = useRef(false);
  const nameButtonRef = useRef<HTMLButtonElement | null>(null);
  const openNameEditor = (): void => {
    skipBlurCommit.current = false;
    setNameText(row.name);
    setEditingName(true);
  };
  const openTagEditor = (): void => {
    skipBlurCommit.current = false;
    setEditingTags(true);
  };

  const commitTags = (): void => {
    setTags(row.ref, tagText.split(","));
    setEditingTags(false);
    refresh();
  };

  // Focus handed over by the panel. A rename of a name-keyed kind changes the
  // row's id -- which is its React key -- so the row that committed the rename
  // UNMOUNTS and a different one takes its place. A ref captured before the
  // rename is null by the time any microtask runs, which is why this is a
  // mount-time claim by the NEW row rather than a restore by the old one.
  useEffect(() => {
    if (!focusName) return;
    nameButtonRef.current?.focus();
    onFocusTaken();
  }, [focusName, onFocusTaken]);

  const commitName = (): void => {
    setEditingName(false);
    if (nameText.trim() === row.name) {
      // Nothing to do, and no toast for it -- but the input is going away, so
      // focus still has to land somewhere other than <body>. This row is not
      // remounting, so its own ref is the right target.
      queueMicrotask(() => nameButtonRef.current?.focus());
      return;
    }
    const result = renameRecipe(row.ref, nameText);
    onResult(result);
    if (result.ok) {
      // Address the row by where it ENDED UP. For the stable-id kinds that is
      // this same row; for the name-keyed kinds it is the one about to mount.
      if (result.ref) onRenamedTo(rowKey(result.ref));
      refresh();
    } else {
      setNameText(row.name); // a refusal leaves the row showing the truth
      queueMicrotask(() => nameButtonRef.current?.focus());
    }
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
                  // Removing a focused element fires no blur, so this flag is
                  // not consumed here — it is cleared when an editor is next
                  // OPENED (see `openNameEditor`). Setting it still matters for
                  // the case where the element is NOT removed.
                  skipBlurCommit.current = true;
                  setEditingName(false);
                  setNameText(row.name);
                  queueMicrotask(() => nameButtonRef.current?.focus());
                }
                e.stopPropagation();
              }}
            />
          ) : supportsOperation(row.kind, "rename") ? (
            <button
              className="qz-recipe-library-name"
              // The visible text is the recipe name, which alone says nothing
              // about what the button DOES. The label CONTAINS the visible
              // text, which is what WCAG 2.5.3 requires for voice control —
              // as a suffix, not a prefix (an earlier version of this comment
              // said prefix; the code has always produced "Rename <name>").
              aria-label={`Rename ${row.name}`}
              title={`Rename ${row.name}`}
              ref={nameButtonRef}
              onClick={openNameEditor}
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
          {row.lastUsedAt ? (
            <> · used <time dateTime={row.lastUsedAt}>{new Date(row.lastUsedAt).toLocaleDateString()}</time></>
          ) : ""}
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
          <button
            className="qz-recipe-tags"
            aria-label={`Edit tags for ${row.name}`}
            title={`Edit tags for ${row.name}`}
            onClick={openTagEditor}
          >
            {row.tags.length ? row.tags.map((tag) => `#${tag}`).join("  ") : "+ Add tags"}
          </button>
        )}
      </div>
      <RecipeRowActions row={row} onChanged={refresh} onResult={onResult} busy={busy} setBusy={setBusy} />
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
  // One in-flight action across the whole list — see RecipeRowActions' prop doc.
  const [busy, setBusy] = useState(false);
  // Which row should take focus on its next mount. Lives HERE, not in the row,
  // because a rename can destroy the row that asked for it.
  const [focusRowKey, setFocusRowKey] = useState<string | null>(null);
  // Stable identity so the row's focus effect does not re-run every render.
  const clearFocusRow = useCallback(() => setFocusRowKey(null), []);

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

  /** Drop a stale outcome when the thing it described is no longer on screen.
   *  "select a dataset first" sitting there after the user selected one, or
   *  "deleted — undo restores it" after they undid, is worse than silence. */
  const clearResult = (): void => setResult(null);

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
        <Button size="sm" onClick={() => openPlotManager()}>Manage Plot Recipes…</Button>
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
