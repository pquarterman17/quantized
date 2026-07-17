// A folder header in the Library tree (project-organization plan item 3). Caret
// toggles expand; double-click (or the menu) renames inline; the count chip is
// the folder's whole-subtree dataset count. It's also a drop target — dragging a
// dataset row onto it moves that dataset into this folder (whole-row target, no
// split). Context menu: New subfolder, Rename, Delete (reparent — a delete
// re-homes contents, never destroys datasets). Indent is inline (depth * step).
//
// Folder headers ADDITIONALLY accept a dragged folder (plan item 3b): the thin
// top/bottom edge bands reposition the dragged folder as a SIBLING of this one
// (before/after, same parent); the wide middle band reparents it INTO this one.
// See lib/foldertree's dropZoneAt for the pure 3-zone hit-testing. Dropping a
// folder into its own descendant is a silent no-op — `moveFolder` (the store
// action → lib/foldertree's pure `moveFolder`) already guards that cycle via
// `isSelfOrDescendant`, so this component doesn't need to re-check it.
//
// GUI_INTERACTION_PLAN #13: the drag GESTURE now starts only from the grip
// handle (`.qzk-drag-handle`) — the rest of the header keeps its plain
// expand/collapse click and never arms a drag. This changes the drag SOURCE
// affordance only; the onDragOver/onDrop 3-zone drop-target logic below is
// untouched. A folder's `color` (Properties, sub-item 4) tints the caret
// glyph — resolved from the shared `ACCENT_SWATCHES` fixed-paint table
// (store/prefs.ts), the same palette the Preferences accent swatches use.
//
// GUI_INTERACTION #8: the header is now a keyboard-reachable context-menu
// target (ContextMenu key / Shift+F10, matching DatasetRow) with a "⋯"
// resting-cue button coexisting with the drag handle; the menu itself is
// built by `folderRowMenu.ts` from the shared `lib/contextActions.ts`
// registry instead of an inline array.

import { useState } from "react";

import { buildFolderRowMenu } from "./folderRowMenu";
import { DATASET_DND, FOLDER_DND } from "./useLibraryTree";
import ContextMenu from "../overlays/ContextMenu";
import { isContextMenuKeyEvent } from "../../lib/contextActions";
import { childFolders, dropZoneAt, resolveDropBeforeId, type DropZone3 } from "../../lib/foldertree";
import type { FolderNode } from "../../lib/types";
import { ACCENT_SWATCHES } from "../../store/prefs";
import { useApp } from "../../store/useApp";

interface Props {
  folder: FolderNode;
  depth: number;
  count: number;
  expanded: boolean;
}

export default function FolderRow({ folder, depth, count, expanded }: Props) {
  const toggle = useApp((s) => s.toggleFolderExpanded);
  const renameFolder = useApp((s) => s.renameFolder);
  const moveDatasetToFolder = useApp((s) => s.moveDatasetToFolder);
  const moveFolder = useApp((s) => s.moveFolder);
  const [rename, setRename] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Unified drop indicator: "into" for a whole-row dataset-drop OR a folder
  // dropped in the middle band; "above"/"below" for a folder dropped near an
  // edge (reposition as a sibling). Null = no drag currently over this row.
  const [dropZone, setDropZone] = useState<DropZone3 | null>(null);
  // Folder Properties (sub-item 4): a fixed paint value for the picked accent
  // name, or undefined for the neutral default look.
  const folderColorCss = ACCENT_SWATCHES.find((a) => a.id === folder.color)?.c;

  const commit = () => {
    if (rename != null) renameFolder(folder.id, rename);
    setRename(null);
  };
  const expand = () => {
    if (!expanded) toggle(folder.id);
  };

  // GUI_INTERACTION #8: every item's label/gating/run now lives in the
  // shared `lib/contextActions.ts` folder registry — rebuilt on every render
  // (matching the pre-registry cost profile) since it's cheap and only
  // actually shown while `menu` is set.
  const menuItems = buildFolderRowMenu(folder, count, () => setRename(folder.name), expand);

  // Keyboard path (matches DatasetRow): the ContextMenu key / Shift+F10, or
  // the "⋯" resting-cue button, opens the identical menu anchored at the
  // triggering element (no cursor position to anchor a keyboard open to).
  const onHeaderKeyDown = (e: React.KeyboardEvent) => {
    if (!isContextMenuKeyEvent(e)) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left + 8, y: r.bottom });
  };
  const openMenuAt = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom });
  };

  return (
    <div
      className={`qzk-folder-head${dropZone === "into" ? " dropinto" : ""}${
        dropZone === "above" || dropZone === "below" ? ` drop-${dropZone}` : ""
      }`}
      style={{ paddingLeft: 6 + depth * 14 }}
      tabIndex={0}
      onClick={() => toggle(folder.id)}
      onKeyDown={onHeaderKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DATASET_DND)) {
          e.preventDefault();
          if (dropZone !== "into") setDropZone("into");
        } else if (e.dataTransfer.types.includes(FOLDER_DND)) {
          e.preventDefault();
          const zone = dropZoneAt(e.currentTarget.getBoundingClientRect(), e.clientY);
          if (zone !== dropZone) setDropZone(zone);
        }
      }}
      onDragLeave={() => setDropZone(null)}
      onDrop={(e) => {
        const zone = dropZone ?? dropZoneAt(e.currentTarget.getBoundingClientRect(), e.clientY);
        setDropZone(null);
        if (e.dataTransfer.types.includes(DATASET_DND)) {
          const id = e.dataTransfer.getData(DATASET_DND);
          if (!id) return;
          e.preventDefault();
          e.stopPropagation();
          moveDatasetToFolder(id, folder.id);
          expand();
          return;
        }
        if (e.dataTransfer.types.includes(FOLDER_DND)) {
          const draggedId = e.dataTransfer.getData(FOLDER_DND);
          if (!draggedId || draggedId === folder.id) return; // no-op: dropped onto itself
          e.preventDefault();
          e.stopPropagation();
          if (zone === "into") {
            moveFolder(draggedId, folder.id); // reparent — becomes a new child, appended
            expand();
          } else {
            // Reposition as a SIBLING of this folder, under ITS parent.
            const siblingIds = childFolders(useApp.getState().folders, folder.parentId).map((f) => f.id);
            const beforeId = resolveDropBeforeId(siblingIds, folder.id, zone);
            moveFolder(draggedId, folder.parentId, beforeId);
          }
        }
      }}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      {/* Dedicated drag handle (plan #13 sub-item 1) — the ONLY draggable
       *  element, so a drag only ever starts here; renaming still suppresses
       *  it (a native drag would fight the input's own text-selection). */}
      <span
        className="qzk-drag-handle"
        draggable={rename == null}
        tabIndex={0}
        role="button"
        aria-label="Drag to move"
        title="Drag to move"
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(FOLDER_DND, folder.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={(e) => e.stopPropagation()}
      >
        ⠿
      </span>
      {/* Resting cue (GUI_INTERACTION #8): reveals on row hover/focus, opens
       *  the identical menu the header's own right-click does. */}
      <button
        className="qzk-menu-btn"
        title="More actions"
        aria-label="More actions"
        onClick={(e) => {
          e.stopPropagation();
          openMenuAt(e.currentTarget);
        }}
      >
        ⋯
      </button>
      <span className="qzk-group-caret" style={folderColorCss ? { color: folderColorCss } : undefined}>
        {expanded ? "▾" : "▸"}
      </span>
      {rename != null ? (
        <input
          className="qz-input qzk-folder-rename"
          autoFocus
          value={rename}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setRename(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setRename(null);
          }}
        />
      ) : (
        <span
          className="qzk-group-name"
          title={`${folder.name} — double-click to rename`}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRename(folder.name);
          }}
        >
          {folder.name}
        </span>
      )}
      <span className="qzk-group-count">{count}</span>
    </div>
  );
}
