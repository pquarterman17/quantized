// A single Library dataset row: name (double-click to rename), sparkline, footer
// (meta + reorder/duplicate/remove), then tag chips. Each row owns its own
// inline-edit state. Extracted from Library so the list can render rows inside
// the folder tree without duplicating the markup. Also a drop-between reorder
// target (project-organization plan item 3b): dragging another dataset row
// over the top/bottom half of this one shows a thin indicator and, on drop,
// reorders within (or moves into) THIS row's own folder — see lib/foldertree's
// dropEdgeAt/resolveDropBeforeId for the pure hit-testing.

import { useState } from "react";

import Sparkline from "./Sparkline";
import { DATASET_DND } from "./useLibraryTree";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import { Badge } from "../primitives";
import { dropEdgeAt, folderDatasets, resolveDropBeforeId, type DropEdge } from "../../lib/foldertree";
import type { Dataset } from "../../lib/types";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";

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
  /** Sheet number (>1) when this dataset is a non-first sheet of a multi-sheet
   *  Origin pseudo-book group (`lib/grouping.originSheetGroups`) — renders a
   *  subtle indent + "sheet N" chip so the parent/child relation reads at a
   *  glance. Undefined for ordinary datasets and for a group's parent (sheet 1). */
  sheetNumber?: number;
  /** Indent depth in the folder tree (0 = root); shifts the row right so nesting
   *  reads at a glance. Undefined outside the tree view. */
  depth?: number;
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
}: Props) {
  // Staleness badge (#4): amber when this dataset's corrections or fit await
  // recalculation (manual mode) — click runs the dirty set now.
  const staleDs = useApp((s) => s.staleDatasets);
  const staleFits = useApp((s) => s.staleFits);
  const recalcNow = useApp((s) => s.recalcNow);
  const setActive = useApp((s) => s.setActive);
  const toggleSelected = useApp((s) => s.toggleSelected);
  const selectRange = useApp((s) => s.selectRange);
  const removeDataset = useApp((s) => s.removeDataset);
  const removeSelected = useApp((s) => s.removeSelected);
  const mergeSelected = useApp((s) => s.mergeSelected);
  const applyCorrectionsToMany = useApp((s) => s.applyCorrectionsToMany);
  const duplicateDataset = useApp((s) => s.duplicateDataset);
  const moveDataset = useApp((s) => s.moveDataset);
  const renameDataset = useApp((s) => s.renameDataset);
  const addDatasetTag = useApp((s) => s.addDatasetTag);
  const removeDatasetTag = useApp((s) => s.removeDatasetTag);
  const moveDatasetToFolder = useApp((s) => s.moveDatasetToFolder);
  const createFolder = useApp((s) => s.createFolder);
  const folders = useApp((s) => s.folders);

  // Inline editors (null = not editing); rename allows an empty draft.
  const [rename, setRename] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Drop-between indicator (plan item 3b): which edge of THIS row a dragged
  // dataset is currently hovering, or null when no drag is over this row.
  const [dropEdge, setDropEdge] = useState<DropEdge | null>(null);

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
  // the plotted dataset.
  const onRowClick = (e: React.MouseEvent) => {
    if (e.shiftKey) selectRange(d.id);
    else if (e.ctrlKey || e.metaKey) toggleSelected(d.id);
    else setActive(d.id);
  };

  // Right-click: if this row isn't already in the selection, select it first so
  // the menu acts on what the user sees highlighted, then open the menu.
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!selected) setActive(d.id);
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const { selectedIds } = useApp.getState();
  const selectedCount = selectedIds.length;
  const allIds = useApp.getState().datasets.map((x) => x.id);
  // Move acts on the whole multi-selection when this row is part of one (bulk
  // move — item 8); otherwise on this row alone.
  const moveIds = selected && selectedCount > 1 ? selectedIds : [d.id];
  const moveLabel = (dest: string) =>
    moveIds.length > 1 ? `Move ${moveIds.length} selected to ${dest}` : `Move to ${dest}`;
  const menuItems: ContextMenuItem[] = [
    { label: "Plot (make active)", run: () => setActive(d.id), disabled: active },
    { label: "Duplicate", run: () => duplicateDataset(d.id) },
    { label: "Rename…", run: () => setRename(d.name) },
    { label: "Add tag…", run: () => setTag("") },
    // Move into a folder (project-organization item 3). Flat list of folders +
    // an out-to-root option + create-a-new-folder-with-this. (Drag onto a folder
    // header does the same.)
    { separator: true },
    ...folders.map(
      (f): ContextMenuItem => ({
        label: moveLabel(`"${f.name}"`),
        run: () => moveIds.forEach((id) => moveDatasetToFolder(id, f.id)),
        disabled: moveIds.length === 1 && d.folderId === f.id,
      }),
    ),
    ...(d.folderId || moveIds.length > 1
      ? [
          {
            label: moveLabel("top level"),
            run: () => moveIds.forEach((id) => moveDatasetToFolder(id, null)),
          } as ContextMenuItem,
        ]
      : []),
    {
      label: "New folder with this…",
      run: () => moveDatasetToFolder(d.id, createFolder(null, "New Folder")),
    },
    // Batch-apply this dataset's corrections (only when it has any).
    ...(d.corrections
      ? [
          { separator: true } as ContextMenuItem,
          {
            label: "Apply corrections to all",
            run: () => void applyCorrectionsToMany(d.id, allIds),
          } as ContextMenuItem,
          ...(selected && selectedCount > 1
            ? [
                {
                  label: `Apply corrections to ${selectedCount} selected`,
                  run: () => void applyCorrectionsToMany(d.id, selectedIds),
                } as ContextMenuItem,
              ]
            : []),
        ]
      : []),
    // Merge the multi-selection (≥2) into one new dataset.
    ...(selected && selectedCount > 1
      ? [
          { separator: true } as ContextMenuItem,
          { label: `Merge ${selectedCount} selected`, run: mergeSelected } as ContextMenuItem,
        ]
      : []),
    { separator: true },
    { label: "Move up", run: () => moveDataset(d.id, -1), disabled: !canMoveUp },
    { label: "Move down", run: () => moveDataset(d.id, 1), disabled: !canMoveDown },
    { separator: true },
    {
      label: "Remove",
      run: () => {
        removeDataset(d.id);
        toast(`removed ${d.name}`);
      },
      danger: true,
    },
    ...(selected && selectedCount > 1
      ? [
          {
            label: `Remove ${selectedCount} selected`,
            run: () => {
              const n = selectedCount;
              removeSelected();
              toast(`removed ${n} datasets`);
            },
            danger: true,
          } as ContextMenuItem,
        ]
      : []),
  ];

  return (
    <div
      className={`qzk-ds${active ? " active" : ""}${selected ? " selected" : ""}${
        sheetNumber ? " qzk-ds-sheet" : ""
      }${dropEdge ? ` drop-${dropEdge}` : ""}`}
      style={depth ? { marginLeft: depth * 14 } : undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DATASET_DND, d.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DATASET_DND)) return;
        e.preventDefault(); // required every dragover to keep the drop legal
        const edge = dropEdgeAt(e.currentTarget.getBoundingClientRect(), e.clientY);
        if (edge !== dropEdge) setDropEdge(edge);
      }}
      onDragLeave={() => setDropEdge(null)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(DATASET_DND)) return;
        e.preventDefault();
        e.stopPropagation(); // don't let it bubble to FolderRow/Library's file dropzone
        const edge = dropEdge ?? dropEdgeAt(e.currentTarget.getBoundingClientRect(), e.clientY);
        setDropEdge(null);
        const draggedId = e.dataTransfer.getData(DATASET_DND);
        if (!draggedId || draggedId === d.id) return; // no-op: dropped onto itself
        // Reorder within THIS row's own folder (or move into it, if the dragged
        // dataset lived elsewhere — "moves into the between-position's folder").
        const folderId = d.folderId ?? null;
        const siblingIds = folderDatasets(useApp.getState().datasets, folderId).map((x) => x.id);
        const beforeId = resolveDropBeforeId(siblingIds, d.id, edge);
        moveDatasetToFolder(draggedId, folderId, beforeId);
      }}
      onClick={onRowClick}
      onContextMenu={onContextMenu}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      <div className="qzk-ds-top">
        {(staleDs.includes(d.id) || staleFits.includes(d.id)) && (
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
              duplicateDataset(d.id);
            }}
          >
            ⧉
          </button>
          <button
            className="qz-icon-btn"
            title="Remove"
            onClick={(e) => {
              e.stopPropagation();
              removeDataset(d.id);
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
