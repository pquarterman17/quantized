// A single Library dataset row: name (double-click to rename), sparkline, footer
// (meta + reorder/duplicate/remove), then a group chip + tag chips. Each row owns
// its own inline-edit state. Extracted from Library so the list can render rows
// inside collapsible group sections without duplicating the markup.

import { useState } from "react";

import Sparkline from "./Sparkline";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import { Badge } from "../primitives";
import type { Dataset } from "../../lib/types";
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
}

export default function DatasetRow({
  dataset: d,
  active,
  selected,
  showReorder,
  canMoveUp,
  canMoveDown,
  onFilterTag,
}: Props) {
  const setActive = useApp((s) => s.setActive);
  const toggleSelected = useApp((s) => s.toggleSelected);
  const selectRange = useApp((s) => s.selectRange);
  const removeDataset = useApp((s) => s.removeDataset);
  const removeSelected = useApp((s) => s.removeSelected);
  const applyCorrectionsToMany = useApp((s) => s.applyCorrectionsToMany);
  const duplicateDataset = useApp((s) => s.duplicateDataset);
  const moveDataset = useApp((s) => s.moveDataset);
  const renameDataset = useApp((s) => s.renameDataset);
  const addDatasetTag = useApp((s) => s.addDatasetTag);
  const removeDatasetTag = useApp((s) => s.removeDatasetTag);
  const setDatasetGroup = useApp((s) => s.setDatasetGroup);

  // Inline editors (null = not editing); group/rename allow an empty draft.
  const [rename, setRename] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const commitRename = () => {
    if (rename != null) renameDataset(d.id, rename);
    setRename(null);
  };
  const commitTag = () => {
    if (tag && tag.trim()) addDatasetTag(d.id, tag);
    setTag(null);
  };
  const commitGroup = () => {
    if (group != null) setDatasetGroup(d.id, group);
    setGroup(null);
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
  const menuItems: ContextMenuItem[] = [
    { label: "Plot (make active)", run: () => setActive(d.id), disabled: active },
    { label: "Duplicate", run: () => duplicateDataset(d.id) },
    { label: "Rename…", run: () => setRename(d.name) },
    { label: "Add tag…", run: () => setTag("") },
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
    { separator: true },
    { label: "Move up", run: () => moveDataset(d.id, -1), disabled: !canMoveUp },
    { label: "Move down", run: () => moveDataset(d.id, 1), disabled: !canMoveDown },
    { separator: true },
    { label: "Remove", run: () => removeDataset(d.id), danger: true },
    ...(selected && selectedCount > 1
      ? [{ label: `Remove ${selectedCount} selected`, run: removeSelected, danger: true } as ContextMenuItem]
      : []),
  ];

  return (
    <div
      className={`qzk-ds${active ? " active" : ""}${selected ? " selected" : ""}`}
      onClick={onRowClick}
      onContextMenu={onContextMenu}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      <div className="qzk-ds-top">
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
        <span className="qzk-ds-meta">
          {d.data.time.length} pts · {d.data.units[0] || "—"}
        </span>
        <span className="qzk-ds-actions">
          <Badge tone="accent">{d.data.labels.length}ch</Badge>
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
        {group != null ? (
          <input
            className="qz-input qzk-tag-input"
            autoFocus
            placeholder="group…"
            value={group}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setGroup(e.target.value)}
            onBlur={commitGroup}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitGroup();
              if (e.key === "Escape") setGroup(null);
            }}
          />
        ) : (
          <button
            className={d.group ? "qzk-tag qzk-group-chip" : "qzk-tag qzk-tag-add"}
            title={d.group ? `Group "${d.group}" — click to change` : "Set a group"}
            onClick={(e) => {
              e.stopPropagation();
              setGroup(d.group ?? "");
            }}
          >
            {d.group || "group…"}
          </button>
        )}
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
