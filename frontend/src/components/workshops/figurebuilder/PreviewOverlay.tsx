// Interactive figure preview (#13/#14): the rendered PNG with the backend's
// element hit-map layered as percentage-positioned boxes (scale-free — no
// resize observers). Hover outlines an element; click selects it (the view
// focuses the matching #11 panel); double-click a text element edits it
// inline; dragging the legend or an annotation reports the drop point in
// IMAGE pixels (the hook maps those to figure-fraction / data coords).

import { useRef, useState } from "react";

import { isContextMenuKeyEvent } from "../../../lib/contextActions";
import { groupForElement, type FigureHitmap, type HitElement } from "../../../lib/previewmap";
import ContextMenu, { type ContextMenuItem } from "../../overlays/ContextMenu";

const TEXT_ELEMENTS = new Set(["title", "xlabel", "ylabel"]);
// F2.4d: reference lines join the draggable set — the Stage canvas has
// always supported dragging one, and the preview now has the hit target
// (F2.4c) and the panel (F2.3d) to make it round-trip.
const DRAGGABLE = (id: string) => id === "legend" || id.startsWith("ann:") || id.startsWith("refline:");
const elementName = (id: string) => {
  if (id.startsWith("ann:")) return "Annotation";
  if (id.startsWith("series:")) return "Series";
  // F2.4c: without these the generic fallback below renders the raw element
  // id, so the new decor hitboxes would have read "Refline:0" / "Shape:2".
  if (id.startsWith("refline:")) return "Reference line";
  if (id.startsWith("shape:")) return "Shape";
  return id === "xlabel" ? "X axis label" : id === "ylabel" ? "Y axis label" : id[0].toUpperCase() + id.slice(1);
};
/** F2.3b: a "series:N" hitbox becomes reachable once the canonical draft has
 *  per-series controls to open (`canonicalSeriesEditable`) -- legacy/detached
 *  sessions with nothing to edit keep the original "edited on Stage" wording
 *  unchanged, so every EXISTING PreviewOverlay caller/test is byte-identical. */
const elementTitle = (id: string, canonicalSeriesEditable: boolean) => {
  const name = elementName(id);
  if (TEXT_ELEMENTS.has(id)) return `${name} \u2014 double-click to edit; right-click for properties`;
  if (DRAGGABLE(id)) return `${name} \u2014 drag to move; right-click for properties`;
  if (id.startsWith("series:")) {
    return canonicalSeriesEditable
      ? `${name} \u2014 right-click for properties`
      : `${name} \u2014 properties are edited on Stage`;
  }
  // F2.4c: shapes have a panel but no drag gesture (four coordinates and a
  // grab-handle model, unlike a reference line's single value), so the tooltip
  // advertises exactly the one thing that works for them.
  if (id.startsWith("shape:")) return `${name} \u2014 right-click for properties`;
  return name;
};
const hitboxArea = (element: HitElement) => (element.x1 - element.x0) * (element.y1 - element.y0);
/** Keep DOM hitboxes aligned with `hitAt`: smallest box wins; source order breaks ties. */
const hitboxZIndex = (elements: readonly HitElement[], element: HitElement, index: number) =>
  1 + elements.filter((other, otherIndex) =>
    hitboxArea(other) > hitboxArea(element) || (hitboxArea(other) === hitboxArea(element) && otherIndex > index),
  ).length;

export default function PreviewOverlay({
  src,
  map,
  textOf,
  onSelect,
  onEditText,
  onDragEnd,
  canonicalSeries = false,
}: {
  src: string;
  map: FigureHitmap;
  /** Current text of a text element (for the inline editor's initial value). */
  textOf: (id: string) => string;
  onSelect: (id: string) => void;
  onEditText: (id: string, value: string) => void;
  /** Drop position in image pixels. */
  onDragEnd: (id: string, px: number, py: number) => void;
  /** F2.3b: the canonical draft has per-series controls to open (the Series
   *  property group). Default false keeps every other/legacy caller's
   *  "properties are edited on Stage" hitbox exactly as before. */
  canonicalSeries?: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
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

  /** Opening a second text edit while one is unsaved commits the first
   *  (its input never blurs, so it would otherwise be silently discarded). */
  const startTextEdit = (id: string) => {
    if (editing && editing.id !== id) onEditText(editing.id, editing.value);
    setEditing({ id, value: textOf(id) });
  };
  const menuItems = (id: string): ContextMenuItem[] => {
    const seriesEditable = id.startsWith("series:") && canonicalSeries;
    const group = groupForElement(id);
    return [
      { header: elementName(id) },
      group || seriesEditable
        ? { label: "Properties…", run: () => onSelect(id) }
        : id.startsWith("series:")
          ? { label: "Series properties — edit on Stage", disabled: true, run: () => {} }
          : { label: "Properties unavailable", disabled: true, run: () => {} },
      ...(TEXT_ELEMENTS.has(id) ? [{ label: "Edit text…", run: () => startTextEdit(id) }] : []),
    ];
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <img src={src} alt="figure preview" style={{ width: "100%", display: "block" }} />
      {map.elements.map((e, index) => (
        <div
          key={e.id}
          data-element={e.id}
          title={elementTitle(e.id, canonicalSeries)}
          tabIndex={0}
          role="button"
          aria-label={elementTitle(e.id, canonicalSeries)}
          onPointerEnter={() => setHover(e.id)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(e.id)}
          onBlur={() => setHover((current) => (current === e.id ? null : current))}
          onClick={() => onSelect(e.id)}
          onDoubleClick={() => {
            if (TEXT_ELEMENTS.has(e.id)) startTextEdit(e.id);
          }}
          onContextMenu={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            dragRef.current = null;
            setDragPos(null);
            setMenu({ id: e.id, x: ev.clientX, y: ev.clientY });
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              onSelect(e.id);
              return;
            }
            if (isContextMenuKeyEvent(ev)) {
              ev.preventDefault();
              const r = ev.currentTarget.getBoundingClientRect();
              setMenu({ id: e.id, x: r.left + r.width / 2, y: r.top + r.height / 2 });
            }
          }}
          onPointerDown={(ev) => {
            if (ev.button !== 0 || !DRAGGABLE(e.id)) return;
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
            zIndex: hitboxZIndex(map.elements, e, index),
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.id)}
          onClose={() => setMenu(null)}
        />
      )}
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
            // Above every hitbox (hitboxZIndex tops out at map.elements.length)
            // so the edited element's own invisible hitbox can't swallow
            // caret/selection clicks inside the input (PR #116 regression).
            zIndex: map.elements.length + 1,
          }}
        />
      )}
    </div>
  );
}
