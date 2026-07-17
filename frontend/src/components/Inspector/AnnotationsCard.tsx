// Inspector card: text annotations pinned at data coordinates (label a peak, a
// transition, a feature…). Enter X, Y, and text; the label renders via the uPlot
// annotationPlugin as a dot + text. Annotations are global to the Stage (like
// reference lines). Size (MAIN #18) is also settable here — the same field
// the pointer tool's corner-handle drag / object-menu Size +/- write.
//
// GUI_INTERACTION #3 sub-item 4: the X/Y fields on an EXISTING annotation
// (below) are the non-mouse path for "move this annotation" — until this
// landed, repositioning one after creation was drag-only. Typing an exact
// coordinate is a strictly more precise substitute for a nudge, not just a
// menu-parity checkbox.

import { useState } from "react";

import { clampAnnotationSize } from "../../lib/uplotOverlays";
import { useApp } from "../../store/useApp";
import { Button, Card, IconButton, NumberField, RichText } from "../primitives";

export default function AnnotationsCard() {
  const annotations = useApp((s) => s.annotations);
  const addAnnotation = useApp((s) => s.addAnnotation);
  const removeAnnotation = useApp((s) => s.removeAnnotation);
  const updateAnnotation = useApp((s) => s.updateAnnotation);
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [text, setText] = useState("");

  const add = () => {
    const xv = Number(x);
    const yv = Number(y);
    if (Number.isFinite(xv) && Number.isFinite(yv) && text.trim()) {
      addAnnotation(xv, yv, text.trim());
      setText("");
    }
  };

  return (
    <Card title="Annotations" count={annotations.length || undefined} defaultOpen={false}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <NumberField value={x} width={56} placeholder="X" onChange={setX} />
        <NumberField value={y} width={56} placeholder="Y" onChange={setY} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <input
          className="qz-input"
          value={text}
          placeholder="label text"
          style={{ flex: 1 }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Button size="sm" onClick={add}>
          Add
        </Button>
      </div>

      {annotations.map((a) => (
        <div key={a.id} className="qz-meta-row" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span
            className="qz-k"
            style={{ overflow: "hidden", textOverflow: "ellipsis", display: "flex", justifyContent: "space-between" }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              <RichText text={a.text} />
            </span>
            {a.anchor === "page" && <span style={{ color: "var(--text-faint)" }}>page</span>}
          </span>
          {/* Editable X/Y (GUI_INTERACTION #3 sub-item 4) — the non-mouse path
           *  for "move this annotation": typing an exact coordinate, in
           *  place of the read-only (x, y) text every prior version showed. */}
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <NumberField
              value={String(a.x)}
              width={56}
              placeholder="X"
              onChange={(v) => {
                const n = Number(v);
                if (Number.isFinite(n) && v.trim()) updateAnnotation(a.id, { x: n });
              }}
            />
            <NumberField
              value={String(a.y)}
              width={56}
              placeholder="Y"
              onChange={(v) => {
                const n = Number(v);
                if (Number.isFinite(n) && v.trim()) updateAnnotation(a.id, { y: n });
              }}
            />
            <NumberField
              value={String(a.size ?? "")}
              width={40}
              placeholder="px"
              onChange={(v) => {
                const n = Number(v);
                if (Number.isFinite(n) && v.trim()) updateAnnotation(a.id, { size: clampAnnotationSize(n) });
              }}
            />
            <IconButton title="Remove" onClick={() => removeAnnotation(a.id)}>
              ✕
            </IconButton>
          </span>
        </div>
      ))}
    </Card>
  );
}
