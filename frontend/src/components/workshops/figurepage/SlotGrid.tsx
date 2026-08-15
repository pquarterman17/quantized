// Figure page composer (GOTO #4) — the grid of panel slots. Each slot shows
// its assigned source (name + previewed panel label) or an empty drop hint;
// sources drag in from the source list (HTML5 DnD, custom MIME) or click-
// assign via the hook. Click selects a slot (its label/title overrides edit
// in the side panel); the x chip clears it. Pure presentational — all state
// lives in useFigurePage.
//
// FIGURE_AUTHORING_WORKFLOW_PLAN F3.2: a slot's `PanelSourceStatus` (computed
// live every render by `resolvePanelSource`) drives two cues this component
// used to have no idea about: (1) "missing" — the assigned window/figdoc no
// longer exists or can no longer render — replaces the stale cached name with
// a labeled warning instead of silently looking like a normal, live panel;
// (2) "frozen" — the assigned figure won't update if its source data changes
// — gets a subtle glyph next to its name. Neither invents new behavior: both
// are read straight off the same liveness/lifecycle state the preview/export
// path already depends on.
//
// F3.3 adds a third source kind, "figure" (◇, matching the Library's
// Editable figures glyph) — a saved canonical figure picked directly, or how
// a reopened page's panels are named (a saved page only ever references a
// canonical figureId, never a window/figdoc).
//
// F3.4 "unify panel editing": every assigned slot is now a keyboard-reachable
// context-menu target (GUI_INTERACTION #8 convention — tabIndex + the
// ContextMenu key/Shift+F10, mirroring Library/DatasetRow.tsx) with a primary
// double-click/Enter action (panelMenu.ts's `primaryPanelAction`) and a full
// right-click/keyboard menu (`buildPanelMenuItems`) offering edit/promote/
// duplicate-for-page/clear, per source kind. A window- or figdoc-kind slot's
// tooltip now also names its transient (not-yet-durable) status directly on
// the tile, not only at Save time (see the plan's F3.4 decision log).
//
// F3.5 "manual rearrangement": a FILLED slot is now itself draggable — drop
// it on another slot to swap them (`PANEL_SLOT_MIME`, checked before the
// existing source-list `PANEL_SOURCE_MIME` on every drop so the two drag
// kinds can never be confused) — plus a keyboard equivalent, Shift+Arrow,
// mirroring the existing ContextMenu-key/Enter/Delete keyboard conventions
// this component already established in F3.4. Both call the SAME
// `onMoveSlot(from, to)`, which swaps the whole slot record (source + its
// label/title override) as one unit — see lib/figurepage.ts's `moveSlot` doc.

import { useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";

import { isContextMenuKeyEvent } from "../../../lib/contextActions";
import { gridNeighborIndex, type GridDirection, type PageSlot, type PanelSource, type PanelSourceStatus } from "../../../lib/figurepage";
import ContextMenu from "../../overlays/ContextMenu";
import { buildPanelMenuItems, primaryPanelAction, type PanelMenuActions } from "./panelMenu";

export const PANEL_SOURCE_MIME = "application/x-qz-panel-source";
export const PANEL_SLOT_MIME = "application/x-qz-panel-slot";

interface SlotGridProps {
  rows: number;
  cols: number;
  slots: PageSlot[];
  labels: string[]; // per-slot previewed labels (auto sequence + overrides)
  statuses: PanelSourceStatus[]; // per-slot live status (F3.2)
  selected: number | null;
  onSelect: (i: number) => void;
  onClear: (i: number) => void;
  onDropSource: (i: number, source: PanelSource) => void;
  /** F3.5 manual rearrangement — see the module header. */
  onMoveSlot: (from: number, to: number) => void;
  /** F3.4 panel-editing actions, one callback per slot index — see
   *  panelMenu.ts's `PanelMenuActions` for what each does per source kind. */
  onEdit: (i: number) => void;
  onSaveAsFigure: (i: number) => void;
  onPromote: (i: number) => void;
  onDuplicateForPage: (i: number) => void;
}

function parseSource(e: DragEvent): PanelSource | null {
  try {
    const raw = e.dataTransfer.getData(PANEL_SOURCE_MIME);
    if (!raw) return null;
    const v = JSON.parse(raw) as PanelSource;
    return typeof v.id === "string" && typeof v.name === "string" ? v : null;
  } catch {
    return null;
  }
}

/** F3.5: the origin slot index of a panel-tile drag, or null when this drop
 *  didn't carry one (a source-list drag, or an unrelated drop). */
function parseSlotIndex(e: DragEvent): number | null {
  const raw = e.dataTransfer.getData(PANEL_SLOT_MIME);
  if (!raw) return null;
  const i = Number(raw);
  return Number.isInteger(i) ? i : null;
}

const SHIFT_ARROW_DIRECTION: Record<string, GridDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** F3.4: window/figdoc kinds haven't reached a durable canonical identity
 *  yet — named directly on the tile (not only surfaced lazily by F3.3's
 *  Save-time block) per the plan's "make their transient nature clear"
 *  unification decision. "figure" kind has nothing to append: it's already
 *  durable. */
function transientNote(kind: PanelSource["kind"]): string {
  if (kind === "window") return " — open window, not yet a saved figure";
  if (kind === "figdoc") return " — Publication figure (export-only); double-click to make it editable";
  return "";
}

export default function SlotGrid({
  rows,
  cols,
  slots,
  labels,
  statuses,
  selected,
  onSelect,
  onClear,
  onDropSource,
  onMoveSlot,
  onEdit,
  onSaveAsFigure,
  onPromote,
  onDuplicateForPage,
}: SlotGridProps) {
  const [menu, setMenu] = useState<{ i: number; x: number; y: number } | null>(null);

  const actionsFor = (i: number): PanelMenuActions => ({
    onEdit: () => onEdit(i),
    onSaveAsFigure: () => onSaveAsFigure(i),
    onPromote: () => onPromote(i),
    onDuplicateForPage: () => onDuplicateForPage(i),
    onClear: () => onClear(i),
  });

  const openMenuAt = (i: number, x: number, y: number) => setMenu({ i, x, y });

  const onSlotContextMenu = (i: number, status: PanelSourceStatus, e: MouseEvent) => {
    e.preventDefault();
    const items = buildPanelMenuItems(slots[i], status, actionsFor(i));
    if (items.length === 0) return; // empty slot: nothing to act on yet
    onSelect(i);
    openMenuAt(i, e.clientX, e.clientY);
  };

  // GUI_INTERACTION #8 convention (mirrors Library/DatasetRow.tsx): the
  // ContextMenu key / Shift+F10 opens the identical menu; Enter runs the
  // slot's primary action (edit/promote — see panelMenu.ts); Delete/
  // Backspace clears it, giving the existing "×" chip a keyboard equivalent.
  const onSlotKeyDown = (i: number, status: PanelSourceStatus, e: KeyboardEvent<HTMLDivElement>) => {
    const slot = slots[i];
    if (isContextMenuKeyEvent(e)) {
      e.preventDefault();
      const items = buildPanelMenuItems(slot, status, actionsFor(i));
      if (items.length === 0) return;
      onSelect(i);
      const r = e.currentTarget.getBoundingClientRect();
      openMenuAt(i, r.left + 8, r.bottom);
      return;
    }
    if (e.key === "Enter") {
      const primary = primaryPanelAction(slot, status, actionsFor(i));
      if (primary) {
        e.preventDefault();
        primary();
      }
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      // Retrospective-audit P1 fix: consumed unconditionally — an EMPTY slot
      // is still focusable, and its unconsumed Delete leaked to the global
      // handler and removed the active DATASET. No-op when there's nothing
      // to clear.
      e.preventDefault();
      if (slot.source) onClear(i);
    }
    // F3.5: Shift+Arrow moves the FOCUSED panel one grid step in that
    // direction (mirrors the spreadsheet "move selected row" idiom) — a
    // no-op on an empty slot (nothing to move) or at a grid edge (no
    // neighbor). Focus follows the panel to its new tile so repeated
    // presses keep moving the same panel, the same way onMoveSlot's caller
    // (useFigurePage) follows selection.
    if (e.shiftKey && slot.source && e.key in SHIFT_ARROW_DIRECTION) {
      const target = gridNeighborIndex(i, cols, rows, SHIFT_ARROW_DIRECTION[e.key]);
      if (target === null) return;
      e.preventDefault();
      onMoveSlot(i, target);
      const grid = e.currentTarget.parentElement;
      (grid?.querySelector<HTMLElement>(`[data-slot-index="${target}"]`))?.focus();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Retrospective-audit fix: only Shift+Arrow means anything on a slot;
      // BARE arrows leaked to the global prev/next-dataset stepper. Consume
      // until slot-to-slot focus navigation owns them.
      e.preventDefault();
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 6,
        minHeight: 150,
      }}
    >
      {slots.map((slot, i) => {
        const isSel = selected === i;
        // F3.2: "missing" is checked independently of slot.source's mere
        // presence -- a stale-but-still-cached source must not render as if
        // it were a normal, working panel.
        const status = statuses[i] ?? { status: slot.source ? "ok" : "empty", lifecycle: "live" };
        const isMissing = status.status === "missing";
        const isFrozen = status.status === "ok" && status.lifecycle === "frozen";
        const primary = primaryPanelAction(slot, status, actionsFor(i));
        return (
          <div
            key={i}
            data-slot-index={i}
            tabIndex={0}
            draggable={!!slot.source}
            onClick={() => onSelect(i)}
            onDoubleClick={() => primary?.()}
            onContextMenu={(e) => onSlotContextMenu(i, status, e)}
            onKeyDown={(e) => onSlotKeyDown(i, status, e)}
            // F3.5: a filled tile drags itself (rearrange); an empty tile
            // has nothing to offer PANEL_SLOT_MIME, so its own drag is
            // simply inert (draggable=false above).
            onDragStart={(e) => slot.source && e.dataTransfer.setData(PANEL_SLOT_MIME, String(i))}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const fromSlot = parseSlotIndex(e);
              if (fromSlot !== null) {
                onMoveSlot(fromSlot, i);
                return;
              }
              const src = parseSource(e);
              if (src) onDropSource(i, src);
            }}
            style={{
              border: `1px ${slot.source ? "solid" : "dashed"} ${
                isMissing ? "var(--danger)" : isSel ? "var(--accent)" : "var(--border)"
              }`,
              borderRadius: 4,
              padding: "6px 8px",
              minHeight: 56,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              background: slot.source ? "var(--surface-1)" : "transparent",
              overflow: "hidden",
            }}
          >
            {menu && menu.i === i && (
              <ContextMenu
                x={menu.x}
                y={menu.y}
                items={buildPanelMenuItems(slot, status, actionsFor(i))}
                onClose={() => setMenu(null)}
              />
            )}
            <div style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
              <span className="qz-num" style={{ color: "var(--accent)", flex: "none" }}>
                {labels[i] || " "}
              </span>
              {slot.source && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onClear(i);
                  }}
                  title="Remove panel"
                  style={{ marginLeft: "auto", color: "var(--text-faint)", flex: "none" }}
                >
                  {"×"}
                </span>
              )}
            </div>
            {slot.source ? (
              isMissing ? (
                <span
                  role="status"
                  style={{
                    fontSize: 12,
                    color: "var(--danger)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={`"${slot.source.name}" is no longer available - clear or reassign this panel`}
                >
                  {"⚠ missing: "}
                  {slot.source.name}
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={
                    isFrozen
                      ? `${slot.source.name} (frozen snapshot - won't update with new data)`
                      : `${slot.source.name}${transientNote(slot.source.kind)}`
                  }
                >
                  {slot.source.kind === "figure" ? "◇ " : slot.source.kind === "figdoc" ? "▣ " : "□ "}
                  {isFrozen && "❄ "}
                  {slot.source.name}
                </span>
              )
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-faint)" }}>drop a plot here</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
