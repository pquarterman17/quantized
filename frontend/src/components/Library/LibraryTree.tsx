// The Origin-like tree renderer (LIBRARY_WORKBOOK_UX_PLAN PR C) — replaces
// the retired useLibraryTree.ts. Dispatches each flattened lib/libraryHierarchy
// row to its kind's row component and owns roving keyboard focus over the
// flattened list.
//
// Roving-focus model: every row's own anchor element carries a stable DOM
// selector — `data-ds-id` for worksheets (DatasetRow already has it, so it's
// untouched here), `data-lib-row="<canonical key>"` everywhere else — and
// this container moves REAL DOM focus between them (not a simulated
// "logical" focus state), so each row's own already-implemented mouse/
// keyboard handling (DatasetRow/FolderRow's context-menu key, WorkbookRow's
// open/select) keeps working completely unmodified. This container supplies
// only the ACROSS-ROW part: Up/Down/Left/Right/Enter, computed by the pure
// lib/libraryTreeNav.ts against the flattened array, and Escape (blur —
// no established "return focus to the stage" affordance exists yet to
// match, per the plan's C brief).

import { useEffect, useRef } from "react";

import ArtifactRow from "./ArtifactRows";
import DatasetRow from "./DatasetRow";
import FigureRow from "./FigureRow";
import FolderRow from "./FolderRow";
import WorkbookRow from "./WorkbookRow";
import { openLibraryNode } from "./libraryOpen";
import { childFolders, folderDatasets } from "../../lib/foldertree";
import { folderDeleteActions, runContextAction } from "../../lib/contextActions";
import type { Dataset, FolderNode } from "../../lib/types";
import type { FlatLibraryNode, LibraryNode } from "../../lib/libraryHierarchy";
import { indexOfKey, navigate, type NavDirection } from "../../lib/libraryTreeNav";
import { workbookDeleteActions } from "../../lib/workbookContextActions";
import { useApp } from "../../store/useApp";

const NAV_KEYS: Record<string, NavDirection> = {
  ArrowDown: "down",
  ArrowUp: "up",
  ArrowRight: "right",
  ArrowLeft: "left",
};

/** The DOM selector for a row's own focusable anchor. Worksheets reuse
 *  DatasetRow's existing `data-ds-id`; every other kind carries the new
 *  uniform `data-lib-row`. */
function rowSelector(row: FlatLibraryNode): string {
  if (row.node.kind === "worksheet") return `[data-ds-id="${CSS.escape(row.node.entityId)}"]`;
  return `[data-lib-row="${CSS.escape(row.node.key)}"]`;
}

/** The canonical key of the row a DOM element belongs to, or null when it
 *  isn't inside a row anchor at all (e.g. a click landed on the container
 *  background). */
function keyOfRow(el: Element | null): string | null {
  const row = el?.closest("[data-lib-row], [data-ds-id]");
  if (!row) return null;
  const lib = row.getAttribute("data-lib-row");
  if (lib) return lib;
  const dsId = row.getAttribute("data-ds-id");
  return dsId ? `worksheet:${dsId}` : null;
}

/** A folder's whole-subtree DATASET count (independent of the new
 *  hierarchy — this is the same lens lib/foldertree-driven folder bulk
 *  actions already use, unaffected by workbook nesting). Byte-identical to
 *  the retired useLibraryTree.ts's own `subtreeCount`. */
function subtreeCount(folders: FolderNode[], datasets: Dataset[], folderId: string): number {
  let n = folderDatasets(datasets, folderId).length;
  for (const c of childFolders(folders, folderId)) n += subtreeCount(folders, datasets, c.id);
  return n;
}

function toggleExpand(node: LibraryNode): void {
  const s = useApp.getState();
  if (node.kind === "folder") s.toggleFolderExpanded(node.entityId);
  else if (node.kind === "workbook") s.toggleWorkbookExpanded(node.entityId);
}

interface Props {
  /** Computed once by Library.tsx (useLibraryHierarchyRows) — also drives
   *  its own tree-vs-flat decision, so it's a prop rather than a second
   *  independent hook call here. */
  rows: FlatLibraryNode[];
  /** Tag-chip click inside a nested DatasetRow — Library.tsx owns the query. */
  onFilterTag: (tag: string) => void;
}

export default function LibraryTree({ rows, onFilterTag }: Props) {
  const activeId = useApp((s) => s.activeId);
  const selectedIds = useApp((s) => s.selectedIds);
  const folders = useApp((s) => s.folders);
  const datasets = useApp((s) => s.datasets);
  const containerRef = useRef<HTMLDivElement>(null);
  const focusedKeyRef = useRef<string | null>(null);
  const prevRowsRef = useRef(rows);

  const focusRow = (row: FlatLibraryNode | undefined): void => {
    if (!row) return;
    (containerRef.current?.querySelector(rowSelector(row)) as HTMLElement | null)?.focus();
  };

  // Focus survives removal/move of the focused row: if the row that had
  // focus is gone after a re-render (deleted, moved to another folder), and
  // the DOM actually orphaned focus back to <body> (the browser's own
  // behavior when a focused element unmounts), land on the nearest
  // surviving row by its PREVIOUS position. Never steals focus that moved
  // somewhere else in the app for an unrelated reason.
  useEffect(() => {
    const key = focusedKeyRef.current;
    if (key != null && indexOfKey(rows, key) < 0 && document.activeElement === document.body) {
      const prevIdx = indexOfKey(prevRowsRef.current, key);
      const clamped = Math.min(Math.max(prevIdx, 0), rows.length - 1);
      focusRow(rows[clamped]);
    }
    prevRowsRef.current = rows;
  }, [rows]);

  const onFocusCapture = (e: React.FocusEvent) => {
    focusedKeyRef.current = keyOfRow(e.target as Element);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    const key = keyOfRow(e.target as Element);
    const idx = indexOfKey(rows, key);
    if (idx < 0) return;
    // P1 fix — delete-shortcut misfire: Delete/Backspace on a focused
    // folder/workbook row routes to THAT row's own confirmed delete flow,
    // never useGlobalShortcuts.ts's dataset removeSelected() fallback (which
    // would otherwise remove an unrelated worksheet whenever a workbook/
    // folder is librarySelection'd while some dataset is still
    // selectedIds/activeId). Only acts when librarySelection STILL names the
    // exact row the keydown landed on — the L0.25 coherence fix above keeps
    // that true on every normal selection path; this is the belt.
    // preventDefault() is the documented extension protocol (see
    // useGlobalShortcuts.ts's header comment) — it stops the window-level
    // handler from ALSO firing on the same keystroke.
    if (e.key === "Delete" || e.key === "Backspace") {
      const node = rows[idx].node;
      const sel = useApp.getState().librarySelection;
      if (sel && sel.kind === "workbook" && node.kind === "workbook" && sel.id === node.entityId) {
        e.preventDefault();
        runContextAction(workbookDeleteActions[0], { node, onRename: () => {} });
        return;
      }
      if (sel && sel.kind === "folder" && node.kind === "folder" && sel.id === node.entityId) {
        e.preventDefault();
        runContextAction(folderDeleteActions[0], {
          folder: node.entity,
          count: subtreeCount(folders, datasets, node.entityId),
          onRename: () => {},
          onExpand: () => {},
        });
        return;
      }
      return; // worksheet/figure/… row, or a stale librarySelection: defer to the global dataset handler
    }
    if (e.key === "Enter") {
      e.preventDefault();
      openLibraryNode(rows[idx].node);
      return;
    }
    const dir = NAV_KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    const result = navigate(rows, idx, dir);
    if (result.toggleIndex != null) toggleExpand(rows[result.toggleIndex].node);
    else focusRow(result.focusIndex != null ? rows[result.focusIndex] : undefined);
  };

  return (
    <div className="qzk-lib-tree" onKeyDown={onKeyDown} onFocusCapture={onFocusCapture} ref={containerRef}>
      {rows.map(({ node, expanded, hasChildren }) => {
        switch (node.kind) {
          case "folder":
            return (
              <FolderRow
                key={node.key}
                folder={node.entity}
                depth={node.depth}
                count={subtreeCount(folders, datasets, node.entityId)}
                expanded={expanded}
              />
            );
          case "workbook":
            return <WorkbookRow key={node.key} node={node} depth={node.depth} expanded={expanded} hasChildren={hasChildren} />;
          case "worksheet":
            return (
              <DatasetRow
                key={node.key}
                dataset={node.entity}
                active={node.entity.id === activeId}
                selected={selectedIds.includes(node.entity.id)}
                showReorder={false}
                canMoveUp={false}
                canMoveDown={false}
                onFilterTag={onFilterTag}
                depth={node.depth}
              />
            );
          case "origin-figure":
            return <FigureRow key={node.key} entry={node.entity} depth={node.depth} />;
          default:
            return <ArtifactRow key={node.key} node={node} depth={node.depth} />;
        }
      })}
    </div>
  );
}
