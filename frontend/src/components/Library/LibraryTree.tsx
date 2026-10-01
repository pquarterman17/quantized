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
// only the ACROSS-ROW part: Up/Down/Left/Right/Home/End/Enter, computed by
// the pure lib/libraryTreeNav.ts against the flattened array, and Escape
// (left alone on a row, which keeps focus; from a nested control, an inline
// editor or the scroll-out holder, back to the row).
//
// U5 — WAI-ARIA tree: role="tree" here, role="treeitem" (level, set size,
// position, expanded, selected) on each anchor via `treeItemProps`, and ONE
// roving tab stop: the focused row, else the selected row, else the first,
// clamped to the rendered window so virtualization never leaves the tree
// with no stop. Only that row's own controls stay tabbable (innerTabIndex).

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { buildArtifactMenu, deleteArtifactConfirmed, isArtifactNode, type ArtifactNode } from "./artifactContextActions";
import { isEditorTarget, isTextEditorTarget, keyOfRow, NAV_KEYS, rowSelector } from "./libraryTreeDom";
import LibraryTreeRow from "./LibraryTreeRow";
import { isSelected, openLibraryNode, selectLibraryNode } from "./libraryOpen";
import { focusRowWhenRendered, useListVirtualization } from "./useListVirtualization";
import { subtreeCount, subtreeCountIndex } from "../../lib/foldertree";
import { isContextMenuKeyEvent, runContextAction } from "../../lib/contextActions";
import { folderDeleteActions } from "./folderRowMenu";
import { requestDatasetRemoval } from "../../lib/datasetRemoval";
import { needsScrollOutFocusFallback, scrollOutFocusProps } from "../../lib/scrollOutFocus";
import type { FlatLibraryNode, LibraryNode } from "../../lib/libraryHierarchy";
import { indexOfKey, navigate, treeItemProps, treePositions } from "../../lib/libraryTreeNav";
import { workbookDeleteActions } from "../../lib/workbookContextActions";
import { useApp } from "../../store/useApp";
import { useLibraryStore } from "../../store/hooks/useLibraryStore";
import ContextMenu from "../overlays/ContextMenu";

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
  /** The real scrolling ancestor (Library.tsx's `<aside>`) — E-c3
   *  virtualization measures/scrolls THIS, not the row container, since the
   *  header/search/sections above the tree share its one scrollbar. Absent
   *  in standalone test harnesses; the virtualization hook degrades to the
   *  row container itself (see useListVirtualization's header). */
  panelRef?: RefObject<HTMLElement | null>;
  onFocusContainer?: (node: Extract<LibraryNode, { kind: "folder" | "workbook" }>) => void;
}

export default function LibraryTree({ rows, onFilterTag, panelRef, onFocusContainer }: Props) {
  const activeId = useApp((s) => s.activeId);
  const selectedIds = useApp((s) => s.selectedIds);
  const librarySelection = useLibraryStore((s) => s.librarySelection);
  const folders = useApp((s) => s.folders);
  const datasets = useApp((s) => s.datasets);
  const containerRef = useRef<HTMLDivElement>(null);
  const focusedKeyRef = useRef<string | null>(null);
  // The last row that held focus — the roving tab stop's first choice. Unlike
  // the ref it is never cleared, so Tab back into the tree returns there.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const prevRowsRef = useRef(rows);
  // Set by the focus-recovery effect to claim the scroll window for one render,
  // so the selection effect below cannot override it (review round).
  const recoveringRef = useRef(false);
  const [artifactMenu, setArtifactMenu] = useState<{ x: number; y: number; node: ArtifactNode } | null>(null);
  const folderCounts = useMemo(() => subtreeCountIndex(folders, datasets), [folders, datasets]);
  // E-c3 "keep selection operations indexed": built once per render, not
  // once per row — see isSelected's doc in libraryOpen.ts.
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const virt = useListVirtualization(rows.length, panelRef, containerRef, "[data-lib-row], [data-ds-id]");
  const rendered = virt.virtualized ? rows.slice(virt.start, virt.end) : rows;
  const offset = virt.virtualized ? virt.start : 0;
  const positions = useMemo(() => treePositions(rows), [rows]);

  const focusRow = (row: FlatLibraryNode | undefined, index: number, fromSelector?: string): void => {
    if (!row) return;
    if (!virt.virtualized) {
      (containerRef.current?.querySelector(rowSelector(row)) as HTMLElement | null)?.focus();
      return;
    }
    virt.ensureVisible(index);
    focusRowWhenRendered(rowSelector(row), fromSelector ? [fromSelector] : [], containerRef.current);
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
      recoveringRef.current = true; // claim the window; see the selection effect below
      focusRow(rows[clamped], clamped);
    }
    prevRowsRef.current = rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focusRow closes over virt, stable per render intent
  }, [rows]);

  // ORGANIC-SCROLL focus fallback (lib/scrollOutFocus). A mouse-wheel scroll
  // that unmounts the focused row orphans focus to <body> with no keystroke to
  // recover it — this container takes it instead, and onKeyDown resumes from
  // the roving row. Placed after the removal recovery above, whose case (the
  // row is GONE from the model) the shared predicate excludes.
  useEffect(() => {
    const row = rows[indexOfKey(rows, focusedKeyRef.current)];
    const selector = row ? rowSelector(row) : null;
    if (needsScrollOutFocusFallback(virt.virtualized, selector, row != null, containerRef.current)) {
      containerRef.current?.focus();
    }
  }, [virt.virtualized, virt.start, virt.end, rows]);

  // E-c3: "Show in Library" (and any ordinary selection change) keeps the
  // now-selected row inside the rendered window — selectLibraryNode runs
  // BEFORE the reveal effect's scrollIntoView retry (Library.tsx), so
  // without this the retry's target row never mounts under virtualization
  // and the reveal silently fails to scroll.
  //
  // REVIEW ROUND, two defects here. (a) This was keyed on the selectedRow
  // OBJECT, and `flattenLibraryHierarchy` allocates fresh row wrappers on every
  // rebuild — so it re-fired on ANY unrelated model change and yanked the window
  // back to the selection while the user was reading somewhere else (measured:
  // renaming an unrelated dataset moved the window from d278..d312 to d0..d33).
  // Keyed on the row's stable KEY now, so it fires when the SELECTION changes,
  // which is what it is for. (b) It runs after the focus-recovery effect above
  // and called `ensureVisible` unconditionally, overriding that effect's window
  // — so deleting the focused row while a DIFFERENT row was selected left
  // `document.activeElement` on <body>. Body focus plus the Delete keybinding is
  // exactly the data-loss path `lib/focusGuard.ts` exists to prevent, so the
  // recovery wins: it sets `recoveringRef` and this effect stands down for that
  // render.
  const selectedRow = rows.find((r) => isSelected(r.node, selectedIdSet, librarySelection));
  const selectedKey = selectedRow?.node.key ?? null;
  const modelStop = (indexOfKey(rows, focusKey) >= 0 ? focusKey : null) ?? selectedKey ?? rows[0]?.node.key ?? null;
  const tabStopKey = rendered.some((r) => r.node.key === modelStop) ? modelStop : rendered[0]?.node.key ?? null;
  useEffect(() => {
    if (recoveringRef.current) {
      recoveringRef.current = false;
      return;
    }
    if (!virt.virtualized || selectedKey == null) return;
    const idx = indexOfKey(rows, selectedKey);
    if (idx >= 0) virt.ensureVisible(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the STABLE selection key; `rows`/`ensureVisible` are read, not tracked (see the note above)
  }, [selectedKey, virt.virtualized]);

  const onFocusCapture = (e: React.FocusEvent) => {
    // The scroll-out fallback holder is not a row: keep the roving key it was
    // handed focus to stand in for, rather than clearing it to null.
    if (e.target === containerRef.current) return;
    focusedKeyRef.current = keyOfRow(e.target as Element);
    if (focusedKeyRef.current != null) setFocusKey(focusedKeyRef.current);
  };

  // Hands focus back to row `key`'s anchor. `afterUnmount`: an inline editor
  // closing on this very keystroke unmounts on the next render, orphaning
  // focus to <body> — wait a frame, and only reclaim focus nobody else took.
  const refocusRow = (key: string | null, afterUnmount: boolean): void => {
    const row = rows[indexOfKey(rows, key)];
    if (!row) return;
    const focus = (): void => {
      if (afterUnmount && document.activeElement !== document.body) return;
      (containerRef.current?.querySelector(rowSelector(row)) as HTMLElement | null)?.focus();
    };
    if (afterUnmount) requestAnimationFrame(focus);
    else focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The CONTAINER itself holds focus — the scroll-out fallback above put it
    // there. A nav key resumes from the roving row's model position (it is not
    // a row, so `keyOfRow` would find nothing), and Enter/Escape act on that
    // row too (V1: they used to bubble to the window handlers); every other
    // key, Delete included, falls through to the guard below, which consumes
    // it rather than let it reach the global dataset handlers.
    const rovingIdx = indexOfKey(rows, focusedKeyRef.current);
    const fromContainer = e.target === containerRef.current && rovingIdx >= 0
      && (NAV_KEYS[e.key] != null || e.key === "Enter" || e.key === "Escape");
    // P2 fix: a nested editor/control owns its own keystrokes — see
    // isEditorTarget's doc. Must run before Escape too: an editor's own
    // Escape (rename input's onKeyDown) stays its own, never ALSO treated as
    // the row's own Escape below. Retrospective-audit P1: a nested
    // NON-EDITOR control (drag handle, "⋯"/reorder/figure buttons) doesn't
    // handle Delete or bare arrows itself, so those are consumed here —
    // never left to reach the global handlers and act on an unrelated
    // dataset. Enter/Space/Tab pass untouched (button activation).
    if (!fromContainer && isEditorTarget(e.target as Element)) {
      // U5: Escape from a nested control, or Escape/Enter closing an inline
      // editor (whose own handler already cancelled/committed), returns
      // focus to the row rather than leaving it on <body>.
      const text = isTextEditorTarget(e.target as Element);
      if (e.key === "Escape" || (text && e.key === "Enter")) refocusRow(keyOfRow(e.target as Element), text);
      const isDestructiveOrNav =
        e.key === "Delete" || e.key === "Backspace" || e.key === "ArrowUp" || e.key === "ArrowDown";
      if (isDestructiveOrNav && !isTextEditorTarget(e.target as Element)) e.preventDefault();
      return;
    }
    // V1: Escape on a row keeps focus there and goes on to the app's Escape
    // ladder, as in Details. On the holder it is the tree's: back to the row.
    if (e.key === "Escape") {
      if (fromContainer) {
        e.preventDefault();
        focusRow(rows[rovingIdx], rovingIdx);
      }
      return;
    }
    const key = fromContainer ? focusedKeyRef.current : keyOfRow(e.target as Element);
    const idx = indexOfKey(rows, key);
    if (idx < 0) return;
    if (isContextMenuKeyEvent(e) && isArtifactNode(rows[idx].node)) {
      e.preventDefault();
      const rect = (e.currentTarget.querySelector(rowSelector(rows[idx])) as HTMLElement).getBoundingClientRect();
      setArtifactMenu({ x: rect.left + 8, y: rect.bottom, node: rows[idx].node });
      return;
    }
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
        // Honor the same L0.45 gate the menu shows disabled (a keystroke
        // must never confirm-then-no-op; registry convention keeps run()
        // dispatchable for disabled items, so the caller checks).
        const del = workbookDeleteActions[0];
        const target = { node, onRename: () => {} };
        if (del.enabled?.(target) === false) return;
        runContextAction(del, target);
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
      // Worksheet rows (round-3 P1 fix): the tree consumes Delete here too
      // and targets the FOCUSED row explicitly — roving focus moves without
      // changing selectedIds, so deferring to the global selection-based
      // handler could remove a DIFFERENT dataset (the stale selection, or
      // the active plot as its fallback). A focused row that's part of the
      // live multi-selection deletes the whole selection (Ctrl/Cmd batch
      // semantics preserved); otherwise exactly this row. The shared
      // lib/datasetRemoval.ts helper keeps confirmRemove/status/toast/
      // Trash/one-Undo identical to the global path.
      if (node.kind === "worksheet") {
        e.preventDefault();
        const ids = useApp.getState().selectedIds;
        requestDatasetRemoval(ids.length > 0 && ids.includes(node.entityId) ? ids : [node.entityId]);
        return;
      }
      // Artifact rows (E-b2): Delete routes through the SAME registry action
      // as the lifecycle menu — shared confirm + dependency warning, and the
      // helper honors the action's `enabled` gate (recovered Origin figures
      // stay a consumed no-op). This closes the debt the swallowed-keystroke
      // contract booked ("until a registry action defines one").
      if (isArtifactNode(node)) {
        e.preventDefault();
        deleteArtifactConfirmed(node);
        return;
      }
      // Every remaining row kind consumes the key (P1 review fix): a
      // mismatched-selection row has no dataset selection of its own, so
      // falling through would hand Delete to the global handler against an
      // UNRELATED dataset.
      e.preventDefault();
      return;
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
    else if (result.focusIndex != null) focusRow(rows[result.focusIndex], result.focusIndex, rowSelector(rows[idx]));
  };

  return (
    <div
      className="qzk-lib-tree"
      role="tree"
      aria-label="Library"
      aria-multiselectable="true"
      {...scrollOutFocusProps}
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
      onContextMenu={(event) => {
        const key = keyOfRow(event.target as Element);
        const node = rows.find((row) => row.node.key === key)?.node;
        if (!node || !isArtifactNode(node)) return;
        event.preventDefault();
        selectLibraryNode(node);
        setArtifactMenu({ x: event.clientX, y: event.clientY, node });
      }}
      ref={containerRef}
      style={virt.virtualized ? { paddingTop: virt.padTop, paddingBottom: virt.padBottom } : undefined}
    >
      {rendered.map((row, i) => (
        <LibraryTreeRow
          key={row.node.key}
          row={row}
          treeItem={treeItemProps(row, offset + i, positions, isSelected(row.node, selectedIdSet, librarySelection), row.node.key === tabStopKey)}
          activeId={activeId}
          selectedIds={selectedIdSet}
          folderCounts={folderCounts}
          onFilterTag={onFilterTag}
          onFocusContainer={onFocusContainer}
        />
      ))}
      {artifactMenu && (
        <ContextMenu
          x={artifactMenu.x}
          y={artifactMenu.y}
          items={buildArtifactMenu(artifactMenu.node)}
          help={{ label: "saved items", query: "graph window" }}
          onClose={() => setArtifactMenu(null)}
        />
      )}
    </div>
  );
}
