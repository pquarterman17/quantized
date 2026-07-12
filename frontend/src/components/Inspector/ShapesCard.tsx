// Inspector card: drawn shapes (MAIN #27 — arrow/line/rect/ellipse) pinned
// on the plot. Overview list (kind glyph + stroke color chip + anchor tag +
// delete) + "Clear all" — matches the RefLines/Annotations card conventions
// for the list/delete half. Unlike those cards, there's no inline "add"
// form here: a shape is created via the plot's dock flyout / Insert menu
// (drag-to-draw needs a live canvas, not a text field), so this card is
// purely the overview + bulk-delete surface.

import { resolveShapeStroke } from "../../lib/uplotShapes";
import { useApp } from "../../store/useApp";
import { Button, Card, IconButton } from "../primitives";

const KIND_GLYPH: Record<string, string> = { arrow: "↗", line: "╱", rect: "▭", ellipse: "◯" };

export default function ShapesCard() {
  const shapes = useApp((s) => s.shapes);
  const removeShape = useApp((s) => s.removeShape);
  const clearShapes = useApp((s) => s.clearShapes);
  const selectedShapeId = useApp((s) => s.selectedShapeId);
  const setSelectedShapeId = useApp((s) => s.setSelectedShapeId);

  return (
    <Card title="Shapes" count={shapes.length || undefined} defaultOpen={false}>
      {shapes.length === 0 && (
        <div className="qz-hint" style={{ color: "var(--text-dim)", fontSize: 11 }}>
          Draw one from the plot's ▱ dock button or the Insert menu.
        </div>
      )}
      {shapes.map((sh) => (
        <div
          key={sh.id}
          className="qz-meta-row"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
          onClick={() => setSelectedShapeId(sh.id === selectedShapeId ? null : sh.id)}
        >
          <span className="qz-k" style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-faint)" }}>
              {sh.kind}
              {sh.anchor === "page" ? " (page)" : ""}
            </span>
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
