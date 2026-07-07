// Interactive figure preview (#13/#14): the rendered PNG with the backend's
// element hit-map layered as percentage-positioned boxes (scale-free — no
// resize observers). Hover outlines an element; click selects it (the view
// focuses the matching #11 panel); double-click a text element edits it
// inline; dragging the legend or an annotation reports the drop point in
// IMAGE pixels (the hook maps those to figure-fraction / data coords).

import { useRef, useState } from "react";

import type { FigureHitmap, HitElement } from "../../../lib/previewmap";

const TEXT_ELEMENTS = new Set(["title", "xlabel", "ylabel"]);
const DRAGGABLE = (id: string) => id === "legend" || id.startsWith("ann:");

export default function PreviewOverlay({
  src,
  map,
  textOf,
  onSelect,
  onEditText,
  onDragEnd,
}: {
  src: string;
  map: FigureHitmap;
  /** Current text of a text element (for the inline editor's initial value). */
  textOf: (id: string) => string;
  onSelect: (id: string) => void;
  onEditText: (id: string, value: string) => void;
  /** Drop position in image pixels. */
  onDragEnd: (id: string, px: number, py: number) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const pct = (e: HitElement) => ({
    left: `${(e.x0 / map.width) * 100}%`,
    top: `${(e.y0 / map.height) * 100}%`,
    width: `${((e.x1 - e.x0) / map.width) * 100}%`,
    height: `${((e.y1 - e.y0) / map.height) * 100}%`,
  });

  /** Client coords -> image pixels (the img is width-fit inside the container). */
  const toImagePx = (clientX: number, clientY: number): [number, number] => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return [0, 0];
    const scale = map.width / rect.width;
    return [(clientX - rect.left) * scale, (clientY - rect.top) * scale];
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <img src={src} alt="figure preview" style={{ width: "100%", display: "block" }} />
      {map.elements.map((e) => (
        <div
          key={e.id}
          data-element={e.id}
          title={
            TEXT_ELEMENTS.has(e.id)
              ? `${e.id} — double-click to edit`
              : DRAGGABLE(e.id)
                ? `${e.id} — drag to move`
                : e.id
          }
          onPointerEnter={() => setHover(e.id)}
          onPointerLeave={() => setHover(null)}
          onClick={() => onSelect(e.id)}
          onDoubleClick={() => {
            if (TEXT_ELEMENTS.has(e.id)) setEditing({ id: e.id, value: textOf(e.id) });
          }}
          onPointerDown={(ev) => {
            if (!DRAGGABLE(e.id)) return;
            dragRef.current = { id: e.id, startX: ev.clientX, startY: ev.clientY };
            // optional-chained: jsdom has no pointer capture
            (ev.target as Element).setPointerCapture?.(ev.pointerId);
          }}
          onPointerMove={(ev) => {
            const d = dragRef.current;
            if (!d || d.id !== e.id) return;
            setDragPos({ id: e.id, dx: ev.clientX - d.startX, dy: ev.clientY - d.startY });
          }}
          onPointerUp={(ev) => {
            const d = dragRef.current;
            dragRef.current = null;
            setDragPos(null);
            if (!d || d.id !== e.id) return;
            const moved =
              Math.abs(ev.clientX - d.startX) + Math.abs(ev.clientY - d.startY) > 3;
            if (!moved) return; // a plain click — selection already handled
            const [px, py] = toImagePx(ev.clientX, ev.clientY);
            onDragEnd(e.id, px, py);
          }}
          style={{
            position: "absolute",
            ...pct(e),
            cursor: DRAGGABLE(e.id) ? "move" : "pointer",
            outline:
              hover === e.id ? "1.5px solid var(--accent)" : "1px solid transparent",
            borderRadius: 2,
            transform:
              dragPos?.id === e.id
                ? `translate(${dragPos.dx}px, ${dragPos.dy}px)`
                : undefined,
          }}
        />
      ))}
      {editing && (
        <input
          className="qz-input"
          autoFocus
          value={editing.value}
          onChange={(ev) => setEditing({ ...editing, value: ev.target.value })}
          onBlur={() => {
            onEditText(editing.id, editing.value);
            setEditing(null);
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              onEditText(editing.id, editing.value);
              setEditing(null);
            }
            if (ev.key === "Escape") setEditing(null);
          }}
          style={{
            position: "absolute",
            ...pct(map.elements.find((e) => e.id === editing.id)!),
            minWidth: 120,
            zIndex: 2,
          }}
        />
      )}
    </div>
  );
}
