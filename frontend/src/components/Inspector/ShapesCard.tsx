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

import { resolveShapeStroke } from "../../lib/uplotShapes";
import { useApp } from "../../store/useApp";
import { Button, Card, IconButton, NumberField } from "../primitives";

const KIND_GLYPH: Record<string, string> = { arrow: "↗", line: "╱", rect: "▭", ellipse: "◯" };

export default function ShapesCard() {
  const shapes = useApp((s) => s.shapes);
  const removeShape = useApp((s) => s.removeShape);
  const updateShape = useApp((s) => s.updateShape);
  const clearShapes = useApp((s) => s.clearShapes);
  const selectedShapeId = useApp((s) => s.selectedShapeId);
  const setSelectedShapeId = useApp((s) => s.setSelectedShapeId);

  // Nudge one coordinate of one shape — the shared onChange body for all
  // four fields below (only the patched key differs).
  const setCoord = (id: string, key: "x1" | "y1" | "x2" | "y2") => (v: string) => {
    const n = Number(v);
    if (Number.isFinite(n) && v.trim()) updateShape(id, { [key]: n });
  };

  return (
    <Card title="Shapes" count={shapes.length || undefined} defaultOpen={false}>
      {shapes.length === 0 && (
        <div className="qz-hint" style={{ color: "var(--text-dim)", fontSize: 11 }}>
          Draw one from the plot's ▱ dock button or the Insert menu.
        </div>
      )}
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
                removeShape(sh.id);
              }}
            >
              ✕
            </IconButton>
          </span>
          {/* Editable x1/y1 → x2/y2 (GUI_INTERACTION #3 sub-item 4) — the
           *  non-mouse path for "move/reshape this shape"; see the module doc. */}
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <NumberField value={String(sh.x1)} width={48} placeholder="x1" onChange={setCoord(sh.id, "x1")} />
            <NumberField value={String(sh.y1)} width={48} placeholder="y1" onChange={setCoord(sh.id, "y1")} />
            <span style={{ color: "var(--text-faint)" }}>→</span>
            <NumberField value={String(sh.x2)} width={48} placeholder="x2" onChange={setCoord(sh.id, "x2")} />
            <NumberField value={String(sh.y2)} width={48} placeholder="y2" onChange={setCoord(sh.id, "y2")} />
          </span>
        </div>
      ))}
      {shapes.length > 0 && (
        <Button size="sm" onClick={clearShapes} style={{ marginTop: 6 }}>
          Clear all
        </Button>
      )}
    </Card>
  );
}
