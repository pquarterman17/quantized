// A folder header in the Library tree (project-organization plan item 3). Caret
// toggles expand; double-click (or the menu) renames inline; the count chip is
// the folder's whole-subtree dataset count. It's also a drop target — dragging a
// dataset row onto it moves that dataset into this folder. Context menu: New
// subfolder, Rename, Delete (reparent — a delete re-homes contents, never
// destroys datasets). Indent is inline (depth * step).

import { useState } from "react";

import { DATASET_DND } from "./useLibraryTree";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import type { FolderNode } from "../../lib/types";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";

interface Props {
  folder: FolderNode;
  depth: number;
  count: number;
  expanded: boolean;
}

export default function FolderRow({ folder, depth, count, expanded }: Props) {
  const toggle = useApp((s) => s.toggleFolderExpanded);
  const createFolder = useApp((s) => s.createFolder);
  const renameFolder = useApp((s) => s.renameFolder);
  const deleteFolder = useApp((s) => s.deleteFolder);
  const moveDatasetToFolder = useApp((s) => s.moveDatasetToFolder);
  const [rename, setRename] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dropHover, setDropHover] = useState(false);

  const commit = () => {
    if (rename != null) renameFolder(folder.id, rename);
    setRename(null);
  };
  const expand = () => {
    if (!expanded) toggle(folder.id);
  };

  const items: ContextMenuItem[] = [
    {
      label: "New subfolder",
      run: () => {
        createFolder(folder.id, "New Folder");
        expand();
      },
    },
    { label: "Rename…", run: () => setRename(folder.name) },
    { separator: true },
    {
      label: "Delete folder",
      run: () => {
        deleteFolder(folder.id); // reparent: contents move up; datasets are never deleted
        toast(`deleted folder "${folder.name}"`);
      },
      danger: true,
    },
  ];

  return (
    <div
      className={`qzk-folder-head${dropHover ? " dropinto" : ""}`}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={() => toggle(folder.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DATASET_DND)) {
          e.preventDefault();
          if (!dropHover) setDropHover(true);
        }
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => {
        setDropHover(false);
        const id = e.dataTransfer.getData(DATASET_DND);
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        moveDatasetToFolder(id, folder.id);
        expand();
      }}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
      <span className="qzk-group-caret">{expanded ? "▾" : "▸"}</span>
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
