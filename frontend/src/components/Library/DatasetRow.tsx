// A single Library dataset row. Two layouts share one component (and one
// set of interaction hooks) so behavior can never drift between them:
//   - the FULL CARD (treeMode=false — the flat/search list, Smart Folders):
//     name row, sparkline, meta+actions footer, tag row. Unchanged since
//     before UX-001.
//   - the COMPACT ROW (treeMode=true — the Tree view, LibraryTree.tsx): one
//     line — type glyph, name, concise meta, an opt-in preview toggle — a
//     visual peer of FigureRow's single-line `.qzk-fig-item` instead of a
//     tall always-expanded card. UX-001 (plans/BUGS_AND_ISSUES.md): Tree
//     worksheet cards were reported large/inconsistent next to compact
//     saved-graph rows, and the always-mounted Sparkline (DatasetRowPreview
//     now gates it behind an explicit toggle) was ~120+ synchronous SVG
//     builds on one Tree render.
//
// GUI_INTERACTION_PLAN #13: the drag GESTURE starts only from the grip handle
// (`.qzk-drag-handle`, the only `draggable` element) — the rest of the row
// keeps its normal select/open behaviour. The full context menu lives in
// datasetRowMenu.ts; the leading control cluster (drag handle/menu button/
// stale dot/marks/sheet chip) and the name (static/rename-input) are their
// own sibling component — DatasetRowParts.tsx — so the compact layout
// doesn't duplicate them and this file stays under the component ceiling.
// The handle's DATASET_DND payload is still a live drag
// SOURCE for the plot-window rebind drop target (WindowCanvas.tsx/
// PlotWindowFrame.tsx) — only the Library-internal row-as-drop-target
// behavior below was retired (PR C review fix): this row no longer accepts
// a DATASET_DND drop itself (it used to reorder/move-into-a-folder via
// lib/foldertree's moveDatasetToFolder), because the tree places a worksheet
// by its WORKBOOK (lib/libraryHierarchy.ts), not its own `folderId` — the
// dropped-here `order`/`folderId` write was invisible in the tree and
// diverged from the workbook's real placement, the same defect class
// FolderRow's retired dataset-onto-folder drop had. Moving a worksheet
// between workbooks is the split-workbook workflow (PR J).
//
// GUI_INTERACTION #8: keyboard-reachable context menu — `tabIndex` + the
// ContextMenu key (or Shift+F10) opens the SAME menu the "⋯" resting-cue
// button and right-click do. Most items come from `lib/contextActions.ts`'s
// dataset registry via `datasetRowMenu.ts`; this row only supplies the two
// local UI hooks (inline rename/tag inputs) the registry can't own itself.
//
// Reused inside the Library TREE (LIBRARY_WORKBOOK_UX_PLAN PR C) as the
// worksheet row — see LibraryTree.tsx's dispatcher and this row's own
// onRowClick (records L0.6's remembered workbook child on open).

import { useState } from "react";

import { buildDatasetRowMenu, removeDatasetConfirmed } from "./datasetRowMenu";
import DatasetRowPreview from "./DatasetRowPreview";
import { DatasetRowControls, DatasetRowName } from "./DatasetRowParts";
import { recordWorkbookOpen } from "./libraryOpen";
import Sparkline from "./Sparkline";
import { isContextMenuKeyEvent } from "../../lib/contextActions";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import ContextMenu from "../overlays/ContextMenu";
import { Badge } from "../primitives";

interface Props {
  dataset: Dataset;
  active: boolean;
  /** Row is part of the multi-selection (ctrl/shift-click) — highlighted for bulk ops. */
  selected: boolean;
  showReorder: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Click a tag chip to filter the library to that tag. */
  onFilterTag: (tag: string) => void;
  /** Sheet number (>1) for a non-first sheet of a multi-sheet Origin pseudo-book
   *  group (`lib/grouping.originSheetGroups`) — renders a "sheet N" chip.
   *  Undefined for ordinary datasets and a group's parent (sheet 1). */
  sheetNumber?: number;
  /** Indent depth in the folder tree (0 = root); shifts the row right so nesting
   *  reads at a glance. Undefined outside the tree view. */
  depth?: number;
  /** "Folder › Subfolder" caption (plan #13 sub-item 2) — set by Library.tsx
   *  ONLY while showing a flat filtered/search result list, where a row's
   *  location isn't otherwise visible (the tree view already shows it via
   *  nesting). Undefined = no caption rendered. */
  folderCaption?: string;
  /** L0.25 (PR #139 review) — set by LibraryTree only: plain click SELECTS
   *  (selectIds, no plot change), double-click/Enter OPENS; right-click/
   *  menu-key select without activating. Ctrl/Cmd + Shift keep their
   *  app-wide meaning in both modes. Unset (flat/search): the established
   *  plot-intent click (item 15) is unchanged — L0.26 "normal open". Also
   *  the compact-vs-full-card switch (UX-001): true renders the Tree's
   *  one-line row, false the flat list's full card. */
  treeMode?: boolean;
}

export default function DatasetRow({
  dataset: d,
  active,
  selected,
  showReorder,
  canMoveUp,
  canMoveDown,
  onFilterTag,
  sheetNumber,
  depth = 0,
  folderCaption,
  treeMode = false,
}: Props) {
  // Staleness badge (#4): amber when this dataset's corrections or fit await
  // recalculation (manual mode) — click runs the dirty set now.
  const staleDs = useApp((s) => s.staleDatasets);
  const staleFits = useApp((s) => s.staleFits);
  const stale = staleDs.includes(d.id) || staleFits.includes(d.id);
  const recalcNow = useApp((s) => s.recalcNow);
  const activateFromLibrary = useApp((s) => s.activateFromLibrary);
  const toggleSelected = useApp((s) => s.toggleSelected);
  const selectRange = useApp((s) => s.selectRange);
  const selectIds = useApp((s) => s.selectIds);
  const duplicateDataset = useApp((s) => s.duplicateDataset);
  const moveDataset = useApp((s) => s.moveDataset);
  const renameDataset = useApp((s) => s.renameDataset);
  const addDatasetTag = useApp((s) => s.addDatasetTag);
  const removeDatasetTag = useApp((s) => s.removeDatasetTag);
  const folders = useApp((s) => s.folders);

  // Inline editors (null = not editing); rename allows an empty draft.
  const [rename, setRename] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const commitRename = () => {
    if (rename != null) renameDataset(d.id, rename);
    setRename(null);
  };
  const commitTag = () => {
    if (tag && tag.trim()) addDatasetTag(d.id, tag);
    setTag(null);
  };

  // Plain click activates (and collapses the selection); ctrl/cmd toggles this row
  // in the multi-selection; shift selects a range from the anchor — neither moves
  // the plotted dataset. Routes through `activateFromLibrary` (item 15), not
  // `setActive` directly, so an Origin-project row opens its Worksheet instead
  // of rebinding the focused plot window, per the `originBookClickOpens` pref.
  // PR C: records L0.6's remembered workbook child. L0.25 librarySelection
  // clearing now lives at the STORE level (activateFromLibrary/
  // toggleSelected/selectRange/setActive), not re-implemented here.
  const open = () => {
    activateFromLibrary(d.id);
    recordWorkbookOpen(d.workbookId, `worksheet:${d.id}`);
  };
  const onRowClick = (e: React.MouseEvent) => {
    if (e.shiftKey) selectRange(d.id);
    else if (e.ctrlKey || e.metaKey) toggleSelected(d.id);
    // L0.25 tree mode: a plain click selects WITHOUT touching the plot; the
    // open (double-click here, Enter via LibraryTree) is a separate gesture.
    else if (treeMode) selectIds([d.id]);
    else open();
  };

  // Right-click/menu-key: a not-yet-selected row is selected first so the
  // menu acts on what's highlighted — via selectIds in tree mode (never
  // changes the active plot, L0.25), via plain-click routing (item 15) flat.
  const selectForMenu = () => {
    if (selected) return;
    if (treeMode) selectIds([d.id]);
    else activateFromLibrary(d.id);
  };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    selectForMenu();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  // Keyboard path (GUI_INTERACTION #8): the ContextMenu key / Shift+F10 opens
  // the identical menu, anchored at the row's own bottom-left corner (native
  // context-menu convention) since there's no cursor position to anchor to.
  const onRowKeyDown = (e: React.KeyboardEvent) => {
    if (!isContextMenuKeyEvent(e)) return;
    e.preventDefault();
    selectForMenu();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left + 8, y: r.bottom });
  };
  // The "⋯" resting-cue button (DatasetRowControls): selects first, then opens
  // at `el`. Review round (UX-001): this used to call `activateFromLibrary`
  // directly, so opening the menu from "⋯" CHANGED THE ACTIVE PLOT in tree
  // mode while right-click on the same row did not — and the comment here
  // claimed the two matched. In tree mode that also broke L0.25 ("never
  // changes the active plot"), which `selectForMenu` exists to honour. Now it
  // is genuinely the same gesture through the same helper: `selectIds` in
  // tree mode, plain-click routing flat.
  const openMenuAt = (el: HTMLElement) => {
    selectForMenu();
    const r = el.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom });
  };

  const menuItems = buildDatasetRowMenu(
    d,
    active,
    selected,
    folders,
    canMoveUp,
    canMoveDown,
    () => setRename(d.name),
    () => setTag(""),
  );

  const nameProps = {
    dataset: d,
    rename,
    onChange: setRename,
    onCommit: commitRename,
    onCancel: () => setRename(null),
    onStart: () => setRename(d.name),
  };

  // UX-001 review round: tags are SHARED by both layouts, not owned by the full
  // card. Leaving them in the card branch made Tree view silently lose real
  // function — "Add tag…" in the context menu still called `setTag("")` but no
  // input rendered (a dead no-op), and existing chips, chip-click filtering and
  // per-tag removal were unreachable. Compactness was never meant to cost
  // features. In the compact row this is a full-width flex child that wraps onto
  // its own line, so it occupies NO height unless the dataset actually has tags
  // or the user is adding one.
  const tagsEl = (
  <div className={`qzk-ds-tags${treeMode ? " qzk-ds-tags-compact" : ""}`}>
    {(d.tags ?? []).map((t) => (
      <span
        key={t}
        className="qzk-tag"
        title={`Filter by "${t}"`}
        onClick={(e) => {
          e.stopPropagation();
          onFilterTag(t);
        }}
      >
        {t}
        <button
          className="qzk-tag-x"
          title="Remove tag"
          onClick={(e) => {
            e.stopPropagation();
            removeDatasetTag(d.id, t);
          }}
        >
          ×
        </button>
      </span>
    ))}
    {tag != null ? (
      <input
        className="qz-input qzk-tag-input"
        autoFocus
        placeholder="tag…"
        value={tag}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setTag(e.target.value)}
        onBlur={commitTag}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitTag();
          if (e.key === "Escape") setTag(null);
        }}
      />
    ) : (
      <button
        className="qzk-tag qzk-tag-add"
        title="Add tag"
        onClick={(e) => {
          e.stopPropagation();
          setTag("");
        }}
      >
        ＋
      </button>
    )}
  </div>
  );

  const rowClassName = `qzk-ds${treeMode ? " qzk-ds-compact" : ""}${active ? " active" : ""}${selected ? " selected" : ""}${sheetNumber ? " qzk-ds-sheet" : ""}`;
  // #38: a pending dataset's `data` is just the small downsampled preview —
  // show the TRUE row/channel counts (carried on the pending ref) instead of
  // the preview's, so the Library never under-reports a book's real size
  // while it's still lazy. Shared by both layouts below.
  const pts = d.pending ? d.pending.rows : d.data.time.length;
  const ch = d.pending ? d.pending.cols : d.data.labels.length;
  const pendingTitle = d.pending ? "full data loads on first view" : undefined;
  const controls = (
    <DatasetRowControls dataset={d} stale={stale} onRecalc={() => void recalcNow()} sheetNumber={sheetNumber} onOpenMenu={openMenuAt} />
  );
  const nameEl = <DatasetRowName {...nameProps} />;
  const folderCaptionEl = folderCaption && (
    <span className="qzk-ds-path" title={`in ${folderCaption}`}>
      {folderCaption}
    </span>
  );

  return (
    <div
      className={rowClassName}
      style={depth ? { marginLeft: depth * 14 } : undefined}
      data-ds-id={d.id}
      tabIndex={0}
      // UX-001: `active` = shown in the focused window (LibraryTree passes
      // `id === activeId`) -- semantic marker for the `.active` CSS class,
      // independent of multi-select's `selected`/`.selected`.
      aria-current={active ? "true" : undefined}
      onKeyDown={onRowKeyDown}
      onClick={onRowClick}
      // L0.25 tree open gesture; the NAME span's dbl-click rename wins over it.
      onDoubleClick={treeMode ? open : undefined}
      onContextMenu={onContextMenu}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      {treeMode ? (
        <>
          <div className="qzk-ds-compact-row">
            {controls}
            {/* Node-type glyph (UX-001 interaction checklist: "make the node
             *  type explicit") — the Tree already has one for Folder (▦) and
             *  Workbook (▤); this is Worksheet's, same aria-hidden+title
             *  convention as those two. */}
            <span className="qzk-ds-icon" aria-hidden="true" title="Worksheet">▥</span>
            {nameEl}
            <span className="qzk-ds-compact-meta" title={pendingTitle}>
              {pts} pts · {ch}ch{d.pending && " · …"}
            </span>
            <DatasetRowPreview dataset={d} />
            {tagsEl}
          </div>
          {folderCaptionEl}
        </>
      ) : (
        <>
          <div className="qzk-ds-top">
            {controls}
            {nameEl}
          </div>
          {folderCaptionEl}
          <Sparkline data={d.data} />
          <div className="qzk-ds-foot">
            <span className="qzk-ds-meta" title={pendingTitle}>
              {pts} pts · {d.data.units[0] || "—"}
              {d.pending && " · …"}
            </span>
            <span className="qzk-ds-actions">
              <Badge tone="accent">{ch}ch</Badge>
              {showReorder && (
                <>
                  <button
                    className="qz-icon-btn"
                    title="Move up"
                    aria-label="Move up"
                    disabled={!canMoveUp}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveDataset(d.id, -1);
                    }}
                  >
                    ▲
                  </button>
                  <button
                    className="qz-icon-btn"
                    title="Move down"
                    aria-label="Move down"
                    disabled={!canMoveDown}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveDataset(d.id, 1);
                    }}
                  >
                    ▼
                  </button>
                </>
              )}
              <button
                className="qz-icon-btn"
                title="Duplicate"
                aria-label="Duplicate"
                onClick={(e) => {
                  e.stopPropagation();
                  void duplicateDataset(d.id);
                }}
              >
                ⧉
              </button>
              <button
                className="qz-icon-btn"
                title="Remove"
                aria-label={`Remove ${d.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeDatasetConfirmed(d);
                }}
              >
                ✕
              </button>
            </span>
          </div>
          {tagsEl}
        </>
      )}
    </div>
  );
}
