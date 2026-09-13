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
// REVIEW ROUND (2026-09-13, finding 5): a WORKSHEET tile does not render a
// grip at all, even though the shared hook happily returns `handleProps` for
// one (`dragSourceOf`'s `DATASET_DND` case, useDetailsDragDrop.ts). In
// Details that grip is a real gesture — the plot-target payload lands on a
// Stage window docked right next to the table. In Tiles there is no such
// target: this workspace REPLACES the Stage while it is open
// (`App.tsx`'s `libraryViewMode === "tiles"` branch), and a folder tile only
// ever accepts `WORKBOOK_DND`/`FOLDER_DND`. A worksheet drag in Tiles is
// therefore a drag to nowhere — nothing on screen can receive it — so
// showing the grip would offer a gesture that always fails silently.
// Suppressing it here (rather than making the hook lie about the kind) is
// honest: the keyboard/AT route to the same move is unaffected, since it was
// always the tile menu's "Move to …" items, not this grip.
//
// Two invariants the grip is careful about:
//   * It is not a tab stop and not an AT target (`aria-hidden`, no tabindex),
//     exactly like the Details grip. The grid's keyboard model is a ROVING
//     tabindex over tiles (LibraryWorkspace's `effectiveTabStop`, plus the
//     `lib/scrollOutFocus` container fallback when the roving tile scrolls
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
      // Nit N3 (review round): spread FIRST. JSX resolves same-named props by
      // SOURCE ORDER — last one wins — so spreading `rowProps` before the
      // tile's own explicit handlers means a future name collision (e.g. an
      // `onDragOver` added here) is decided by the handler visibly written
      // below, not silently overwritten by the hook's. Today's two sets are
      // disjoint (drag-target props vs. click/keyboard), so this changes
      // nothing yet.
      {...dnd.rowProps}
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
    >
      {/* Finding 5: no grip for a worksheet tile — Tiles has no reachable
          drop target for its DATASET_DND payload while the Stage it targets
          is replaced by this very workspace (see the header note). */}
      {dnd.handleProps && node.kind !== "worksheet" && (
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
