// A workbook header in the Library tree (LIBRARY_WORKBOOK_UX_PLAN PR C,
// L0.1/L0.5/L0.6). Modeled on FolderRow.tsx's header shape (same classes,
// same disclosure-caret convention) but with workbook-specific interaction:
//
//   L0.5 — the disclosure ARROW toggles expansion and does nothing else. It
//   stops propagation on both click and double-click so it can never select
//   or open the workbook underneath it.
//   L0.6 — a single click on the row body SELECTS (librarySelection);
//   double-click or Enter OPENS the remembered child, falling back to the
//   first worksheet for a workbook with no remembered child yet
//   (libraryOpen.ts's openLibraryNode owns that dispatch).
//
// Rename has no dedicated gesture on the row (double-click is reserved for
// open, unlike FolderRow) — it's reached only through the context menu's
// "Rename…", which opens the same inline input FolderRow uses.

import { useState } from "react";

import { openLibraryNode } from "./libraryOpen";
import { buildWorkbookRowMenu } from "./workbookRowMenu";
import { isContextMenuKeyEvent } from "../../lib/contextActions";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import ContextMenu from "../overlays/ContextMenu";

interface Props {
  node: Extract<LibraryNode, { kind: "workbook" }>;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
}

export default function WorkbookRow({ node, depth, expanded, hasChildren }: Props) {
  const workbook = node.entity;
  const toggle = useApp((s) => s.toggleWorkbookExpanded);
  const selection = useApp((s) => s.librarySelection);
  const renameWorkbook = useApp((s) => s.renameWorkbook);
  const [rename, setRename] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const selected = selection?.kind === "workbook" && selection.id === workbook.id;
  const worksheetCount = node.children.filter((c) => c.kind === "worksheet").length;

  const commitRename = () => {
    if (rename != null) renameWorkbook(workbook.id, rename);
    setRename(null);
  };
  const select = () => useApp.getState().setLibrarySelection({ kind: "workbook", id: workbook.id });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!isContextMenuKeyEvent(e)) return;
    e.preventDefault();
    select();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left + 8, y: r.bottom });
  };
  const openMenuAt = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom });
  };

  const menuItems = buildWorkbookRowMenu(node, () => setRename(workbook.name));

  return (
    <div
      className={`qzk-folder-head qzk-workbook-row${selected ? " selected" : ""}`}
      style={{ paddingLeft: 6 + depth * 14 }}
      data-lib-row={node.key}
      tabIndex={0}
      onClick={select}
      onDoubleClick={() => openLibraryNode(node)}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        select();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      <button
        className="qzk-menu-btn"
        title="More actions"
        aria-label="More actions"
        onClick={(e) => {
          e.stopPropagation();
          select();
          openMenuAt(e.currentTarget);
        }}
      >
        ⋯
      </button>
      {/* L0.5: the disclosure caret is the ONLY expand/collapse gesture and
       *  must never select or open — both click and double-click stop here. */}
      <span
        className="qzk-group-caret"
        role="button"
        tabIndex={-1}
        aria-label={expanded ? "Collapse workbook" : "Expand workbook"}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) toggle(workbook.id);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {hasChildren ? (expanded ? "▾" : "▸") : "·"}
      </span>
      <span className="qzk-workbook-icon" aria-hidden="true" title="Workbook">▤</span>
      {rename != null ? (
        <input
          className="qz-input qzk-folder-rename"
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
        <span className="qzk-group-name" title={`${workbook.name} — double-click to open`}>
          {workbook.name}
        </span>
      )}
      {workbook.originBook && (
        <span className="qzk-tag" title={`Origin workbook "${workbook.originBook}"`}>
          Origin
        </span>
      )}
      <span
        className="qzk-group-count"
        title={`${worksheetCount} worksheet${worksheetCount === 1 ? "" : "s"}`}
      >
        {worksheetCount}
      </span>
    </div>
  );
}
