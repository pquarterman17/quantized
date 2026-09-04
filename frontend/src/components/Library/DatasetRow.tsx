// A single Library dataset row: name (double-click to rename), sparkline, footer
// (meta + reorder/duplicate/remove), then tag chips. Each row owns its own
// inline-edit state. Extracted from Library so the list can render rows inside
// the folder tree without duplicating the markup.
//
// GUI_INTERACTION_PLAN #13: the drag GESTURE starts only from the grip handle
// (`.qzk-drag-handle`, the only `draggable` element) — the rest of the row
// keeps its normal select/open behaviour. The full context menu moved to
// datasetRowMenu.ts (this file sits at the 400-line ceiling). The handle's
// DATASET_DND payload is still a live drag SOURCE for the plot-window rebind
// drop target (WindowCanvas.tsx/PlotWindowFrame.tsx) — only the Library-
// internal row-as-drop-target behavior below was retired (PR C review fix):
// this row no longer accepts a DATASET_DND drop itself (it used to reorder/
// move-into-a-folder via lib/foldertree's moveDatasetToFolder), because the
// tree places a worksheet by its WORKBOOK (lib/libraryHierarchy.ts), not its
// own `folderId` — the dropped-here `order`/`folderId` write was invisible
// in the tree and diverged from the workbook's real placement, the same
// defect class FolderRow's retired dataset-onto-folder drop had. Moving a
// worksheet between workbooks is the split-workbook workflow (PR J).
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
import { DATASET_DND } from "./dnd";
import { recordWorkbookOpen } from "./libraryOpen";
import Sparkline from "./Sparkline";
import { isContextMenuKeyEvent } from "../../lib/contextActions";
import type { Dataset } from "../../lib/types";
import DerivedWorksheetMark from "./DerivedWorksheetMark";
import RecomputedMark from "./RecomputedMark";
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
   *  plot-intent click (item 15) is unchanged — L0.26 "normal open". */
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
  const setActiveDrag = useApp((s) => s.setActiveDrag);

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
  const openMenuAt = (el: HTMLElement) => {
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

  return (
    <div
      className={`qzk-ds${active ? " active" : ""}${selected ? " selected" : ""}${sheetNumber ? " qzk-ds-sheet" : ""}`}
      style={depth ? { marginLeft: depth * 14 } : undefined}
      data-ds-id={d.id}
      tabIndex={0}
      onKeyDown={onRowKeyDown}
      onClick={onRowClick}
      // L0.25 tree open gesture; the NAME span's dbl-click rename wins over it.
      onDoubleClick={treeMode ? open : undefined}
      onContextMenu={onContextMenu}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      <div className="qzk-ds-top">
        {/* Dedicated drag handle (plan #13 sub-item 1) — the ONLY
         *  draggable="true" element in the row, so a drag can only start
         *  here; the rest of the row keeps its plain select/open click.
         *  Shown on row hover (CSS) and always while keyboard-focused. */}
        <span
          className="qzk-drag-handle"
          draggable
          tabIndex={0}
          role="button"
          aria-label="Drag to move"
          title="Drag to move"
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData(DATASET_DND, d.id);
            e.dataTransfer.effectAllowed = "move";
            // GUI_INTERACTION #3 sub-item 2b: flag every valid drop target
            // (folder rows, plot window frames) the moment the drag starts,
            // not only once the pointer happens to hover one.
            setActiveDrag({ kind: "dataset", id: d.id });
          }}
          onDragEnd={() => setActiveDrag(null)}
          onClick={(e) => e.stopPropagation()}
        >
          ⠿
        </span>
        {/* Resting cue (GUI_INTERACTION #8): a right-click isn't the only way
         *  in — this reveals on row hover/focus (same rule as the drag
         *  handle above) and opens the identical menu, anchored at itself. */}
        <button
          className="qzk-menu-btn"
          title="More actions"
          aria-label="More actions"
          onClick={(e) => {
            e.stopPropagation();
            if (!selected) activateFromLibrary(d.id);
            openMenuAt(e.currentTarget);
          }}
        >
          ⋯
        </button>
        {stale && (
          <span
            className="qzk-stale-dot"
            title="stale — data changed; click to recalculate now"
            onClick={(e) => {
              e.stopPropagation();
              void recalcNow();
            }}
          >
            ●
          </span>
        )}
        <RecomputedMark spec={d.fitSpec} stale={stale} />
        <DerivedWorksheetMark dataset={d} />
        {sheetNumber != null && (
          <span className="qzk-ds-sheet-chip" title={`Sheet ${sheetNumber} of the same Origin workbook`}>
            └ sheet {sheetNumber}
          </span>
        )}
        {rename != null ? (
          <input
            className="qz-input qzk-ds-name"
            autoFocus
            value={rename}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRename(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRename(null);
            }}
          />
        ) : (
          <span
            className="qzk-ds-name"
            title={`${d.name} — double-click to rename`}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRename(d.name);
            }}
          >
            {d.name}
          </span>
        )}
      </div>
      {folderCaption && (
        <span className="qzk-ds-path" title={`in ${folderCaption}`}>
          {folderCaption}
        </span>
      )}
      <Sparkline data={d.data} />
      <div className="qzk-ds-foot">
        <span className="qzk-ds-meta" title={d.pending ? "full data loads on first view" : undefined}>
          {/* #38: a pending dataset's `data` is just the small downsampled
           *  preview — show the TRUE row/channel counts (carried on the
           *  pending ref) instead of the preview's, so the Library never
           *  under-reports a book's real size while it's still lazy. */}
          {d.pending ? d.pending.rows : d.data.time.length} pts · {d.data.units[0] || "—"}
          {d.pending && " · …"}
        </span>
        <span className="qzk-ds-actions">
          <Badge tone="accent">{d.pending ? d.pending.cols : d.data.labels.length}ch</Badge>
          {showReorder && (
            <>
              <button
                className="qz-icon-btn"
                title="Move up"
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
      <div className="qzk-ds-tags">
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
    </div>
  );
}
