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
//     Rename… and no "Move to …" in Details at all. The Tiles-only items are
//     omitted rather than re-pointed: no `browse` hook is supplied, so
//     "Browse" reports itself disabled ("available in Tiles view") exactly as
//     it does on a Tree row.
//   * Rename uses the TREE's gesture, not the Tiles modal: the menu's
//     "Rename…" opens an in-place `.qzk-folder-rename` input on the row,
//     committing on Enter/blur and reverting on Escape — the same class,
//     the same keys, and the same `renameLibraryNode` commit. The open
//     editor's KEY and DRAFT live in LibraryDetails, not here: under
//     virtualization this row unmounts when it scrolls out of the window, and
//     React fires no blur on unmount, so row-local state would silently
//     discard a half-typed name (review round).
//   * A dedicated `.qzk-drag-handle` grip makes the row a drag SOURCE and a
//     folder row a drop TARGET (see useDetailsDragDrop.ts for the contract
//     and for the two deliberate differences from FolderRow's 3-zone drop).
//
// Selection invariants this row is careful about (L0.25; the plan records
// repeated regressions here):
//   * Right-click SELECTS ONLY WHEN THE ROW IS NOT ALREADY SELECTED —
//     DatasetRow's `selectForMenu` rule. The old unconditional
//     `selectLibraryNode` collapsed a live multi-selection to one row on
//     right-click. Note what that does and does not buy: a WORKSHEET row
//     already inside the live multi-selection now keeps it, which is what
//     makes the multi-selection entries ("Move N selected to …", "Remove N
//     selected") reachable from Details. A folder or workbook row is never
//     part of `selectedIds`, so right-clicking one still runs
//     `selectLibraryNode` and still clears `selectedIds` — identical to the
//     Tree, and deliberate: those menus act on the container, not on a
//     worksheet selection.
//   * Renaming touches names only. It never selects, never opens, and never
//     writes `selectedIds`/`librarySelection`.
//   * A drag that is cancelled or dropped somewhere illegal writes nothing
//     but `activeDrag` (set at dragstart, cleared at dragend) — no move, no
//     undo entry, and nothing that touches selection.

import { useState, type CSSProperties } from "react";

import { deleteArtifactConfirmed, isArtifactNode } from "./artifactContextActions";
import { buildLibraryTileMenu } from "./libraryTileMenu";
import { isSelected, openLibraryNode, selectLibraryNode } from "./libraryOpen";
import { renameLibraryNode } from "../../lib/libraryRename";
import { useDetailsDragDrop, type DetailsDragDropContext } from "./useDetailsDragDrop";
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

/** The table's one open inline editor: which row owns it, and the live draft.
 *  Held by LibraryDetails so it outlives this row's unmount. */
export interface DetailsRenameState {
  key: string;
  draft: string;
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
  /** This row's rename draft when IT owns the table's open editor, else null. */
  renameDraft: string | null;
  /** Open (with the node's current name), update, or close that editor. */
  onRenameChange: (next: DetailsRenameState | null) => void;
  /** The table's single set of drag/drop store subscriptions. */
  dndContext: DetailsDragDropContext;
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
  renameDraft,
  onRenameChange,
  dndContext,
  onFocusRow,
  onShowInLibrary,
}: Props) {
  const node = row.node;
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const dnd = useDetailsDragDrop(node, dndContext);
  const selected = isSelected(node, selectedIdSet, selection);
  const isRoving = node.key === rovingKey;

  const commitRename = (): void => {
    const next = renameDraft?.trim();
    onRenameChange(null);
    // Blank reverts (an inline editor's empty field means "I changed my
    // mind", not "name this nothing"); an unchanged name records no history.
    if (next && next !== node.name) renameLibraryNode(node, next);
  };

  // Right-click / menu key acts on what is highlighted, but never COLLAPSES
  // an existing selection this row is already part of (see the header note).
  const selectForMenu = (): void => {
    if (!selected) selectLibraryNode(node);
  };

  // Built ONCE PER OPEN and parked in `menu`, never rebuilt while showing:
  // `buildLibraryTileMenu` reads the store and, for a worksheet, scans
  // `datasets` for the row's index, so rebuilding it on every render of an
  // open menu would cost O(datasets) per render for a list that cannot change
  // under the user's cursor anyway.
  const buildMenu = (): ContextMenuItem[] =>
    buildLibraryTileMenu(node, {
      // No `browse`: "Browse" navigates the TILE WORKSPACE into a node, which
      // Details has no equivalent of. Omitting the hook is what makes the
      // item honestly disabled ("available in Tiles view") instead of an
      // enabled no-op that merely re-selects the row.
      open: () => openLibraryNode(node),
      // Details lives in the Library panel beside the Stage — there is no
      // tile workspace covering the plot to return from.
      stageReturn: () => {},
      // A new subfolder needs no reveal here: the Details projection is flat
      // and already lists every descendant, so the child appears on the next
      // render. (Passing a selection writer would move the highlight to the
      // PARENT instead — the bug this hook exists to prevent.)
      expandFolder: () => {},
      rename: () => onRenameChange({ key: node.key, draft: node.name }),
    });

  const openMenuAt = (x: number, y: number): void => setMenu({ x, y, items: buildMenu() });

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // The rename input owns every key while it is open.
    if (isTextEditorTarget(event.target as Element)) return;
    if (isContextMenuKeyEvent(event)) {
      event.preventDefault();
      selectForMenu();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenuAt(rect.left + 8, rect.bottom);
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
      className={`${selected ? "selected" : ""}${dnd.dropCue ? ` ${dnd.dropCue}` : ""}`.trim() || undefined}
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
        openMenuAt(event.clientX, event.clientY);
      }}
      onKeyDown={onKeyDown}
      {...dnd.rowProps}
    >
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <td className="qzk-details-name" style={{ paddingLeft: indent } as CSSProperties}>
        {dnd.handleProps ? (
          <span
            className="qzk-drag-handle"
            title="Drag to move"
            // Pointer-only affordance, and deliberately NOT a tab stop or an
            // AT target — unlike the Tree's grips, which are `tabIndex={0}`
            // `role="button"`. Two reasons. (a) Details' RESTING sequential
            // tab surface is two stops (the header row and the roving data
            // row; see LibraryDetails.tsx's note and the "ONLY sequential tab
            // stop" test) plus the transient controls a row can put in the
            // roving row's own stop — the reveal button while searching, the
            // rename input while open. A per-row grip would be a PERMANENT
            // third stop on every row. (b) An HTML5 drag cannot be STARTED
            // from the keyboard at all, so a focusable grip would be a focus
            // stop that does nothing; the keyboard/AT route to the identical
            // move is the row menu's "Move to …" items, which are complete
            // for folders and workbooks. Row hover is therefore its only
            // reveal — see shell.css's Details-scoped rule.
            aria-hidden="true"
            {...dnd.handleProps}
            // A native drag fights the input's own text selection, so the
            // grip stands down while this row is being renamed (FolderRow's
            // `draggable={rename == null}` rule).
            draggable={renameDraft == null}
          >
            ⠿
          </span>
        ) : (
          // A kind with no drag source still reserves the grip's box, so every
          // row's name starts at the same x (shell.css sizes both).
          <span className="qzk-details-grip-space" aria-hidden="true" />
        )}
        <span aria-hidden="true">{node.kind === "folder" ? "▦" : node.kind === "workbook" ? "▤" : "·"}</span>
        {renameDraft != null ? (
          <input
            className="qz-input qzk-folder-rename"
            autoFocus
            aria-label={`Rename "${node.name}"`}
            value={renameDraft}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => onRenameChange({ key: node.key, draft: event.target.value })}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") onRenameChange(null);
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
