// One tile of the Tile workspace grid, lifted out of LibraryWorkspace.tsx so
// L1.4's drag/drop parity could land: `useTileDragDrop` is a hook, and the
// grid renders its tiles from a `.map()` where a hook cannot be called. The
// extraction moved the select/open/context-menu/keyboard contract here
// UNCHANGED — LibraryWorkspace still owns every store read and every decision
// that needs the container (focus movement, the enclosing-selection Delete
// rule, the menu's hooks), and passes them in as callbacks.
//
// What is NEW here (L1.4): a `.qzk-drag-handle` grip makes the tile a drag
// SOURCE and a folder tile a drop TARGET, on the contract `useTileDragDrop.ts`
// documents — the SAME hook, payload types, legality rules, cue classes and
// store actions the Details rows and the Tree rows use. There is no
// Tiles-specific move path.
//
// Two invariants the grip is careful about:
//   * It is not a tab stop and not an AT target (`aria-hidden`, no tabindex),
//     exactly like the Details grip. The grid's keyboard model is a ROVING
//     tabindex over tiles (LibraryWorkspace's `effectiveTabStop`, plus the
//     `data-tile-grid-focus` container fallback when the roving tile scrolls
//     out of the window); a focusable per-tile grip would insert a second,
//     permanent stop inside every tile and break that model. An HTML5 drag
//     cannot be started from the keyboard anyway, so the keyboard/AT route to
//     the identical move stays the tile menu's "Move to …" items.
//   * Its click and double-click stop propagating, so grabbing the grip never
//     also selects the tile, and never BROWSES into a folder tile (the tile
//     body's single-click does both).

import { isContextMenuKeyEvent } from "../../lib/contextActions";
import type { LibraryNode, LibraryNodeKey } from "../../lib/libraryHierarchy";
import { libraryTileSummary } from "../../lib/libraryTileSummary";
import TilePreview, { KIND_LABEL } from "./TilePreview";
import { useTileDragDrop, type TileDragDropContext } from "./useTileDragDrop";

interface Props {
  node: LibraryNode;
  selected: boolean;
  /** True for the single tile carrying the grid's tab stop. */
  tabStop: boolean;
  setSize: number;
  posInSet: number;
  /** The grid's ONE set of drag/drop store subscriptions, made once by
   *  LibraryWorkspace and shared by every rendered tile (the Details table's
   *  rule: a per-tile hook would hold six subscriptions per tile). */
  dndContext: TileDragDropContext;
  onSelect: (node: LibraryNode) => void;
  onOpen: (node: LibraryNode) => void;
  onFocus: (key: LibraryNodeKey) => void;
  onMenu: (node: LibraryNode, x: number, y: number) => void;
  /** Delete/Backspace on this tile. LibraryWorkspace owns it because the
   *  worksheet branch needs the live `selectedIds` (enclosing-selection rule)
   *  and reading it here would add a file to the getState()-in-render
   *  ratchet's pinned file count. */
  onDelete: (node: LibraryNode) => void;
  onMoveFocus: (key: LibraryNodeKey, delta: number) => void;
}

export default function LibraryTile({
  node,
  selected,
  tabStop,
  setSize,
  posInSet,
  dndContext,
  onSelect,
  onOpen,
  onFocus,
  onMenu,
  onDelete,
  onMoveFocus,
}: Props) {
  const dnd = useTileDragDrop(node, dndContext);
  const summary = libraryTileSummary(node);

  return (
    <article
      role="listitem"
      data-library-tile={node.key}
      className={`qzk-library-tile${selected ? " selected" : ""}${dnd.dropCue ? ` ${dnd.dropCue}` : ""}`}
      tabIndex={tabStop ? 0 : -1}
      aria-label={`${node.name}, ${KIND_LABEL[node.kind]}`}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      onClick={() => onSelect(node)}
      onDoubleClick={() => onOpen(node)}
      onFocus={() => onFocus(node.key)}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(node, event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (isContextMenuKeyEvent(event)) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(node, rect.left + 8, rect.bottom);
        } else if (event.key === "Enter") {
          event.preventDefault();
          onOpen(node);
        } else if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          onDelete(node);
        } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          onMoveFocus(node.key, 1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          onMoveFocus(node.key, -1);
        }
      }}
      {...dnd.rowProps}
    >
      {dnd.handleProps && (
        <span className="qzk-drag-handle qzk-tile-grip" title="Drag to move" aria-hidden="true" {...dnd.handleProps}>
          ⠿
        </span>
      )}
      <TilePreview node={node} />
      <div className="qzk-library-tile-copy">
        <strong title={node.name}>{node.name}</strong>
        <span>{KIND_LABEL[node.kind]} · {summary.primary}</span>
        {summary.secondary && <span>{summary.secondary}</span>}
        {summary.warning && <em>{summary.warning}</em>}
      </div>
    </article>
  );
}
