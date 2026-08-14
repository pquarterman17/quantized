// Inspector card: drawn shapes (MAIN #27 — arrow/line/rect/ellipse) pinned
// on the plot. Overview list (kind glyph + stroke color chip + anchor tag +
// delete) + "Clear all" — matches the RefLines/Annotations card conventions
// for the list/delete half. Unlike those cards, there's no inline "add"
// form here: a shape is created via the plot's dock flyout / Insert menu
// (drag-to-draw needs a live canvas, not a text field), so this card is
// purely the overview + bulk-delete surface.
//
// GUI_INTERACTION #3 sub-item 4: the x1/y1 → x2/y2 fields below are the
// non-mouse path for "move/reshape this shape" — until this landed, a
// drawn shape had NO way to reposition it except dragging its body/handle
// on the canvas. Every `Shape` kind shares the same four coordinates
// (start/end point for arrow/line, opposite corners for rect/ellipse), so
// one generic field group covers all four kinds with no per-kind branching.

import { useRef } from "react";

import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../lib/focusGuard";
import { resolveShapeStroke } from "../../lib/uplotShapes";
import { useApp } from "../../store/useApp";
import { askConfirm } from "../overlays/ConfirmDialog";
import { BufferedNumberField, Button, Card, IconButton } from "../primitives";

const KIND_GLYPH: Record<string, string> = { arrow: "↗", line: "╱", rect: "▭", ellipse: "◯" };

export default function ShapesCard() {
  const shapes = useApp((s) => s.shapes);
  const removeShape = useApp((s) => s.removeShape);
  const updateShape = useApp((s) => s.updateShape);
  const clearShapes = useApp((s) => s.clearShapes);
  const selectedShapeId = useApp((s) => s.selectedShapeId);
  const setSelectedShapeId = useApp((s) => s.setSelectedShapeId);
  // Focus-safety anchor (lib/focusGuard) — the per-shape ✕ below unmounts
  // its own row; without this, focus falls to <body> and a follow-up Delete
  // keystroke deletes the ACTIVE DATASET instead.
  const containerRef = useRef<HTMLDivElement>(null);

  // Nudge one coordinate of one shape — the shared onValue body for all four
  // fields below (only the patched key differs). Bound through
  // BufferedNumberField (primitives), not a raw NumberField straight to the
  // store number: a controlled field with no local buffer snaps back to the
  // OLD digits on every unparseable keystroke, so typing "-" then "5" to
  // edit 1 into -5 silently produced 15 instead (the digit landed appended
  // to the reverted "1"). BufferedNumberField keeps the in-progress text
  // visible until it resolves to a valid number.
  const setCoord = (id: string, key: "x1" | "y1" | "x2" | "y2") => (v: number | undefined) => {
    if (v !== undefined) updateShape(id, { [key]: v });
  };

  return (
    <Card title="Shapes" count={shapes.length || undefined} defaultOpen={false}>
      {shapes.length === 0 && (
        <div className="qz-hint" style={{ color: "var(--text-dim)", fontSize: 11 }}>
          Draw one from the plot's ▱ dock button or the Insert menu.
        </div>
      )}
      {/* tabIndex=-1: an invisible, programmatic-only focus anchor — see
       *  lib/focusGuard's doc. Not a new Tab stop. onKeyDown absorbs a stray
       *  Delete/Backspace that lands here right after a removal, before it
       *  can bubble to useGlobalShortcuts' window listener. */}
      <div ref={containerRef} tabIndex={-1} onKeyDown={absorbStrayDeleteOnContainer}>
        {shapes.map((sh) => (
          <div key={sh.id} className="qz-meta-row" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span
              className="qz-k"
              style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
              onClick={() => setSelectedShapeId(sh.id === selectedShapeId ? null : sh.id)}
            >
              <span aria-hidden="true">{KIND_GLYPH[sh.kind] ?? "?"}</span>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: resolveShapeStroke(sh, "var(--text)"),
                }}
              />
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-faint)", flex: 1 }}>
                {sh.kind}
                {sh.anchor === "page" ? " (page)" : ""}
              </span>
              <IconButton
                title="Remove"
                onClick={(e) => {
                  e.stopPropagation();
                  removeRowSafely(containerRef.current, () => removeShape(sh.id));
                }}
              >
                ✕
              </IconButton>
            </span>
            {/* Editable x1/y1 → x2/y2 (GUI_INTERACTION #3 sub-item 4) — the
             *  non-mouse path for "move/reshape this shape"; see the module doc. */}
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <BufferedNumberField value={sh.x1} width={48} placeholder="x1" required onValue={setCoord(sh.id, "x1")} />
              <BufferedNumberField value={sh.y1} width={48} placeholder="y1" required onValue={setCoord(sh.id, "y1")} />
              <span style={{ color: "var(--text-faint)" }}>→</span>
              <BufferedNumberField value={sh.x2} width={48} placeholder="x2" required onValue={setCoord(sh.id, "x2")} />
              <BufferedNumberField value={sh.y2} width={48} placeholder="y2" required onValue={setCoord(sh.id, "y2")} />
            </span>
          </div>
        ))}
      </div>
      {shapes.length > 0 && (
        <Button
          size="sm"
          onClick={() => {
            // Bulk wipe gets a confirm; the per-shape ✕ above stays exempt
            // (the canvas-object exemption is scoped to ONE-at-a-time
            // deletes). Undo can restore either way — clearShapes records a
            // "clear shapes" history entry — so the body says so.
            void askConfirm(
              `Clear all ${shapes.length} shape${shapes.length === 1 ? "" : "s"}?`,
              "Every drawn shape on this plot will be removed. You can restore them with Undo.",
              "Clear all",
              true,
            ).then((confirmed) => {
              if (confirmed) clearShapes();
            });
          }}
          style={{ marginTop: 6 }}
        >
          Clear all
        </Button>
      )}
    </Card>
  );
}
