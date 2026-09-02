// One Recipe Library row: the inline favorite / name / tag editors plus the
// row's action strip. Split out of RecipeLibraryPanel.tsx, which reached the
// 400-line component ceiling — the workshop pattern the ratchet prescribes
// (architecture.test.ts #7), not a raised ceiling.
//
// The row owns its two inline editors; it does NOT own where focus lands
// after a rename. `rowKey` is the row's React key and contains the id, and
// for the four name-keyed kinds the id IS the name, so a committed rename
// unmounts this component. The panel therefore holds the focus request and
// the newly mounted row claims it (see `focusName`).

import { useEffect, useRef, useState } from "react";

import { recipeDetails } from "../../../lib/recipeDetails";
import { setFavorite, setTags } from "../../../lib/recipeIndex";
import {
  RECIPE_KIND_LABEL,
  refKey,
  supportsOperation,
  type RecipeDescriptor,
  type RecipeRef,
} from "../../../lib/recipeLibrary";
import type { RecipeSourceInput } from "../../../lib/recipeSources";
import { RecipeDetails } from "./RecipeDetails";
import RecipeRowActions from "./RecipeRowActions";
import { renameRecipe, type ActionResult } from "./recipeActions";

/** The row's identity in the list. Also its React key, so a rename that
 *  changes the id necessarily REMOUNTS the row -- which is why focus
 *  restoration cannot live inside the row for the name-keyed kinds. */
export function rowKey(ref: RecipeRef): string {
  return `${ref.kind}:${ref.scope}:${ref.id}`;
}

export function RecipeRow({
  row,
  sources,
  refresh,
  onResult,
  busy,
  setBusy,
  focusName,
  onFocusTaken,
  onRenamedTo,
}: {
  row: RecipeDescriptor;
  /** The same snapshot the panel built for `collectRecipes` — passed through
   *  so `recipeDetails` can locate the underlying record without a second,
   *  possibly-inconsistent read of the workspace-backed kinds. */
  sources: RecipeSourceInput;
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
  // LOCAL, not lifted to the panel: unlike focus-after-rename, nothing else
  // needs to know whether this row is expanded. It resets to collapsed
  // whenever the row REMOUNTS -- which for a name-keyed kind happens on every
  // committed rename, since `rowKey` (this row's React key) contains the id
  // and the id IS the name for those four. That is an accepted trade — a
  // rename closing the very panel you just used to open it is a minor,
  // truthful surprise, not a bug to work around.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Reset on OPEN, not only consumed on blur. Removing a focused element fires
  // NO blur in any browser or in jsdom, so an Escape-cancel — which unmounts
  // the input — leaves this flag set and the NEXT click-away commit, in either
  // editor of this row, is silently swallowed. (The comment this replaces
  // claimed "Escape fires before blur"; it does not. Verified in review.)
  const skipBlurCommit = useRef(false);
  const nameButtonRef = useRef<HTMLButtonElement | null>(null);
  // `refKey` (not `rowKey`) because this becomes a DOM `id`: it percent-encodes
  // the id half of the composite, so a name-keyed recipe whose name contains
  // whitespace or other id-unsafe characters still yields a valid `id`
  // attribute for `aria-controls` to point at.
  const detailsId = `recipe-details-${refKey(row.ref)}`;
  // `busy` gates OPENING an editor, never one already open: disabling a live
  // <input> strands half-typed text and a browser blurs the disabled element,
  // dropping focus to <body>.
  const openNameEditor = (): void => {
    if (busy) return;
    skipBlurCommit.current = false;
    setNameText(row.name);
    setEditingName(true);
  };
  const openTagEditor = (): void => {
    if (busy) return;
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
        disabled={busy}
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
              disabled={busy}
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
            disabled={busy}
            aria-label={`Edit tags for ${row.name}`}
            title={`Edit tags for ${row.name}`}
            onClick={openTagEditor}
          >
            {row.tags.length ? row.tags.map((tag) => `#${tag}`).join("  ") : "+ Add tags"}
          </button>
        )}
        <button
          type="button"
          className="qz-recipe-details-toggle"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          // The visible text is just "Details" -- a list of rows would
          // otherwise present many buttons all called that, indistinguishable
          // to a screen reader (same reasoning as every action button in
          // RecipeRowActions.tsx). The label CONTAINS the visible text, as
          // WCAG 2.5.3 requires for voice control.
          aria-label={`${detailsOpen ? "Hide" : "Show"} details for ${row.name}`}
          // Deliberately NOT gated by `busy`: unlike the favorite/tag/rename
          // controls above, this changes no state an in-flight action reads
          // -- it only shows or hides a read of what is already loaded.
          onClick={() => setDetailsOpen((v) => !v)}
        >
          <span aria-hidden="true">{detailsOpen ? "▾" : "▸"}</span> Details
        </button>
      </div>
      <RecipeRowActions row={row} onChanged={refresh} onResult={onResult}
        busy={busy} setBusy={setBusy}
        onRename={supportsOperation(row.kind, "rename") ? openNameEditor : undefined} />
      {detailsOpen && <RecipeDetails id={detailsId} details={recipeDetails(row, sources)} />}
    </li>
  );
}
