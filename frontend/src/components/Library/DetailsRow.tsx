// One <tr> of the Details table, lifted out of LibraryDetails.tsx (which sat
// at 393 of the 400-line .tsx ceiling) so L1.4's rename / move / drag-drop
// parity could land without pushing the orchestrator over it.
//
// What moved here UNCHANGED: the L0.25 select/open/context-menu contract, the
// roving tabindex + aria-rowindex bookkeeping, the focused-row Delete
// contract (worksheets and artifacts route to their canonical flows; every
// other kind consumes the key so it can never reach the global
// selection-based handler), and D2's "Show in Library" reveal button.
//
// What is NEW here (L1.4):
//   * The context menu covers EVERY node kind, via `buildLibraryTileMenu` —
//     the same builder the Tile workspace uses, which in turn composes the
//     same dataset/folder/workbook/artifact registries the Tree rows use.
//     Before this, a Details right-click opened a menu only on the five
//     artifact kinds (E-b2), so folders, workbooks and worksheets had no
//     Rename… and no "Move to …" in Details at all.
//   * Rename uses the TREE's gesture, not the Tiles modal: the menu's
//     "Rename…" opens an in-place `.qzk-folder-rename` input on the row,
//     committing on Enter/blur and reverting on Escape — the same class,
//     the same keys, and the same `renameLibraryNode` commit.
//   * A dedicated `.qzk-drag-handle` grip makes the row a drag SOURCE and a
//     folder row a drop TARGET (see useDetailsDragDrop.ts for the contract
//     and for the two deliberate differences from FolderRow's 3-zone drop).
//
// Selection invariants this row is careful about (L0.25; the plan records
// repeated regressions here):
//   * Right-click SELECTS ONLY WHEN THE ROW IS NOT ALREADY SELECTED —
//     DatasetRow's `selectForMenu` rule. The old unconditional
//     `selectLibraryNode` collapsed a live multi-selection to one row on
//     right-click, which made the multi-selection menu entries ("Move N
//     selected to …", "Remove N selected") unreachable from Details.
//   * Renaming touches names only. It never selects, never opens, and never
//     writes `selectedIds`/`librarySelection`.
//   * A drag that is cancelled or dropped somewhere illegal writes nothing
//     but `activeDrag` (set at dragstart, cleared at dragend) — no move, no
//     undo entry, and nothing that touches selection.

import { useState, type CSSProperties } from "react";

import { buildArtifactMenu, deleteArtifactConfirmed, isArtifactNode } from "./artifactContextActions";
import { buildLibraryTileMenu } from "./libraryTileMenu";
import { isSelected, openLibraryNode, selectLibraryNode } from "./libraryOpen";
import { renameLibraryNode } from "../../lib/libraryRename";
import { useDetailsDragDrop } from "./useDetailsDragDrop";
import { isContextMenuKeyEvent } from "../../lib/contextActions";
import { requestDatasetRemoval } from "../../lib/datasetRemoval";
import type { LibraryDetailsRow } from "../../lib/libraryDetails";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";

/** A genuine text-editing control, whose Delete/Backspace/Enter/arrows are
 *  native editing keys no row or table handler may touch. Mirrors
 *  LibraryTree.tsx's identically-named guard — the Tree learned this the
 *  hard way (its P2 "keyboard hijack" fix), and an inline rename input in a
 *  Details row is the exact same hazard: `.closest("[data-lib-row]")`
 *  resolves a nested `<input>` to its ancestor row, so without this a
 *  Backspace while renaming would delete the row being renamed. */
export function isTextEditorTarget(el: Element | null): boolean {
  return el != null && el.matches("input, textarea, select, [contenteditable='true']");
}

interface Column {
  key: string;
  className?: string;
}

interface Props {
  row: LibraryDetailsRow;
  columns: readonly Column[];
  /** Absolute 1-based position in the FULL model (header row = 1), or null
   *  when the table is not virtualized and the DOM already tells the truth. */
  ariaRowIndex: number | null;
  selectedIdSet: ReadonlySet<string>;
  /** The live worksheet multi-selection, in order. Passed down rather than
   *  re-read from the store inside the Delete handler: LibraryDetails already
   *  subscribes to it (it builds `selectedIdSet` from it), so a second read
   *  here would be a duplicate source of the same fact. */
  selectedIds: readonly string[];
  selection: { kind: string; id: string } | null;
  /** The single row currently in the Tab order. */
  rovingKey: string | null;
  indent: number;
  searching: boolean;
  onFocusRow: (key: string) => void;
  onShowInLibrary?: (node: LibraryNode) => void;
}

export default function DetailsRow({
  row,
  columns,
  ariaRowIndex,
  selectedIdSet,
  selectedIds,
  selection,
  rovingKey,
  indent,
  searching,
  onFocusRow,
  onShowInLibrary,
}: Props) {
  const node = row.node;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** Non-null while this row's in-place rename editor is open; holds the
   *  draft text, exactly like FolderRow/WorkbookRow's `rename` state. */
  const [rename, setRename] = useState<string | null>(null);
  const dnd = useDetailsDragDrop(node);
  const selected = isSelected(node, selectedIdSet, selection);
  const isRoving = node.key === rovingKey;

  const commitRename = (): void => {
    const next = rename?.trim();
    setRename(null);
    // Blank reverts (an inline editor's empty field means "I changed my
    // mind", not "name this nothing"); an unchanged name records no history.
    if (next && next !== node.name) renameLibraryNode(node, next);
  };

  // Right-click / menu key acts on what is highlighted, but never COLLAPSES
  // an existing selection this row is already part of (see the header note).
  const selectForMenu = (): void => {
    if (!selected) selectLibraryNode(node);
  };

  // Built ON OPEN, never per render: `buildLibraryTileMenu` reads the store
  // and, for a worksheet, scans `datasets` for the row's index — so building
  // it eagerly would cost O(rendered rows × datasets) on every single render
  // of the table, for a menu that is almost never showing.
  const buildMenu = (): ContextMenuItem[] =>
    buildLibraryTileMenu(node, {
      browse: () => selectLibraryNode(node),
      open: () => openLibraryNode(node),
      // Details lives in the Library panel beside the Stage — there is no
      // tile workspace covering the plot to return from.
      stageReturn: () => {},
      rename: () => setRename(node.name),
    })
    // `buildLibraryTileMenu` returns null only for a kind with no registry;
    // every kind the hierarchy produces has one, and artifacts fall back to
    // the same builder Tree/Tiles use.
    ?? (isArtifactNode(node) ? buildArtifactMenu(node) : []);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // The rename input owns every key while it is open.
    if (isTextEditorTarget(event.target as Element)) return;
    if (isContextMenuKeyEvent(event)) {
      event.preventDefault();
      selectForMenu();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ x: rect.left + 8, y: rect.bottom });
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (node.kind === "worksheet") {
        // A focused row that IS part of the live multi-selection deletes the
        // whole selection (Ctrl/Cmd batch semantics); otherwise exactly this
        // row — roving focus moves without changing selectedIds, so the
        // target must be named explicitly.
        requestDatasetRemoval(
          selectedIds.length > 0 && selectedIds.includes(node.entityId) ? [...selectedIds] : [node.entityId],
        );
      } else if (isArtifactNode(node)) {
        // E-b2: the canonical registry delete (shared confirm + dependency
        // warning; fail-closed on source-managed recovered Origin figures).
        deleteArtifactConfirmed(node);
      }
      return;
    }
    if (event.key === "Enter") {
      // D2: Enter on the focused reveal BUTTON is the button's own
      // activation — let the native click fire instead of opening the row.
      if ((event.target as Element).closest(".qzk-details-reveal")) return;
      event.preventDefault();
      openLibraryNode(node);
    }
  };

  return (
    <tr
      className={`${selected ? "selected" : ""}${dnd.dropActive ? " drop-candidate" : ""}`.trim() || undefined}
      data-lib-row={node.key}
      {...(ariaRowIndex != null ? { "aria-rowindex": ariaRowIndex } : {})}
      data-ds-id={node.kind === "worksheet" ? node.entityId : undefined}
      tabIndex={isRoving ? 0 : -1}
      aria-selected={selected}
      title={`${node.name} — ${row.type}; ${row.location}; ${row.dimensions}; ${row.source}`}
      onFocus={() => onFocusRow(node.key)}
      onClick={() => selectLibraryNode(node)}
      onDoubleClick={() => openLibraryNode(node)}
      onContextMenu={(event) => {
        event.preventDefault();
        selectForMenu();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={onKeyDown}
      {...dnd.rowProps}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={buildMenu()} onClose={() => setMenu(null)} />}
      <td className="qzk-details-name" style={{ paddingLeft: indent } as CSSProperties}>
        {dnd.handleProps && (
          <span
            className="qzk-drag-handle"
            title="Drag to move"
            // Pointer-only affordance, and deliberately NOT a tab stop or an
            // AT target — unlike the Tree's grips, which are `tabIndex={0}`
            // `role="button"`. Two reasons. (a) Details' sequential tab
            // surface is contractually exactly two stops (the header row and
            // the roving data row; see LibraryDetails.tsx's note and the
            // "ONLY sequential tab stop" test) — a per-row grip would make it
            // three. (b) An HTML5 drag cannot be STARTED from the keyboard at
            // all, so a focusable grip would be a focus stop that does
            // nothing; the keyboard/AT route to the identical move is the row
            // menu's "Move to …" items, which are complete for folders and
            // workbooks.
            aria-hidden="true"
            {...dnd.handleProps}
            // A native drag fights the input's own text selection, so the
            // grip stands down while this row is being renamed (FolderRow's
            // `draggable={rename == null}` rule).
            draggable={rename == null}
          >
            ⠿
          </span>
        )}
        <span aria-hidden="true">{node.kind === "folder" ? "▦" : node.kind === "workbook" ? "▤" : "·"}</span>
        {rename != null ? (
          <input
            className="qz-input qzk-folder-rename"
            autoFocus
            aria-label={`Rename "${node.name}"`}
            value={rename}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => setRename(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setRename(null);
            }}
          />
        ) : (
          <span>{node.name}</span>
        )}
        <small>{row.location} · {row.dimensions}</small>
      </td>
      {/* PR L (L0.56): generic over the user's selected columns — `columns`
       *  always starts with the Name column, rendered specially above. */}
      {columns.slice(1).map((col) => (
        <td key={col.key} className={col.className}>
          {row[col.key as Exclude<keyof LibraryDetailsRow, "node" | "manualIndex">]}
        </td>
      ))}
      {searching && (
        <td className="qzk-details-actions">
          {/* Rides the roving row's tab stop: reachable by Tab only from the
           *  focused row (one extra stop while searching). */}
          <button
            type="button"
            className="qzk-details-reveal"
            aria-label="Show in Library"
            title="Show in Library"
            tabIndex={isRoving ? 0 : -1}
            onClick={(event) => {
              event.stopPropagation(); // never also select/open the row
              onShowInLibrary?.(node);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {/* Compact glyph at narrow container widths, full text at ≥300px —
             *  the accessible name lives on the button either way. */}
            <span className="qzk-reveal-glyph" aria-hidden="true">⌖</span>
            <span className="qzk-reveal-text">Show in Library</span>
          </button>
        </td>
      )}
    </tr>
  );
}
