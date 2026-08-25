// Interactive figure preview (#13/#14): the rendered PNG with the backend's
// element hit-map layered as percentage-positioned boxes (scale-free — no
// resize observers). Hover outlines an element; click selects it (the view
// focuses the matching #11 panel); double-click a text element edits it
// inline; dragging a draggable element (legend, annotation, reference line,
// or shape) reports both the drop point AND the press origin in IMAGE
// pixels (the hook diffs them into a translation delta, or maps the drop
// point alone to a figure-fraction / data coordinate).

import { useRef, useState } from "react";

import { isContextMenuKeyEvent } from "../../../lib/contextActions";
import { groupForElement, type FigureHitmap, type HitElement } from "../../../lib/previewmap";
import ContextMenu, { type ContextMenuItem } from "../../overlays/ContextMenu";

const TEXT_ELEMENTS = new Set(["title", "xlabel", "ylabel"]);
/** FU-facet-hitmap: only the FLAT path's title/xlabel/ylabel are editable
 *  inline (`element.panel === undefined`) — a facet panel's own "title"
 *  element is that PANEL's facet-level label, not the figure's title
 *  config field; committing an edit there through `onEditText("title", …)`
 *  would silently overwrite the whole figure's title instead. Per-panel
 *  facet-label editing isn't wired yet (see `FigureHitmap`'s own doc in
 *  `lib/previewmap.ts`), so a faceted "title"/"series:N" hitbox stays
 *  click-to-select only, same as before this element set existed. */
const isTextEditable = (e: HitElement) => TEXT_ELEMENTS.has(e.id) && e.panel === undefined;
/** FU-facet-hitmap fix round 2 (G3): whether ANY entry point (click,
 *  Enter/Space, the context menu's Properties…) has a sound target to route
 *  this element to. A facet panel's own title/xlabel/ylabel (`panel !==
 *  undefined`) has no per-panel edit target yet — `groupForElement("title")`
 *  resolves to "Text & fonts", the FLAT path's whole-figure suptitle
 *  control, so routing a facet panel's own label through it would silently
 *  treat that panel's label as the figure's title. Every selection entry
 *  point shares this ONE gate (not just the double-click path
 *  `isTextEditable` already guarded) so a panel title is never routed to
 *  the wrong object — it does nothing instead of guessing. */
const hasSoundTarget = (e: HitElement) => !(TEXT_ELEMENTS.has(e.id) && e.panel !== undefined);
/** A React key unique across panels — two different facet panels each draw
 *  their own "title" and "series:0" (FU-facet-hitmap), so `id` alone would
 *  collide. The flat path has no `panel` and keeps its original `id` key. */
const elementKey = (e: HitElement) => (e.panel === undefined ? e.id : `${e.panel}:${e.id}`);
// F2.4d: reference lines join the draggable set — the Stage canvas has
// always supported dragging one, and the preview now has the hit target
// (F2.4c) and the panel (F2.3d) to make it round-trip.
// F2.4e: shapes join too — dragElement translates by the pointer's delta
// (drop minus press origin) so the grab offset is preserved, the same feel
// the Stage's own shape drag already has.
const DRAGGABLE = (id: string) =>
  id === "legend" || id.startsWith("ann:") || id.startsWith("refline:") || id.startsWith("shape:");
const elementName = (id: string, panel?: number) => {
  const base = (() => {
    if (id.startsWith("ann:")) return "Annotation";
    if (id.startsWith("series:")) return "Series";
    // F2.4c: without these the generic fallback below renders the raw
    // element id, so the new decor hitboxes would have read "Refline:0" /
    // "Shape:2".
    if (id.startsWith("refline:")) return "Reference line";
    if (id.startsWith("shape:")) return "Shape";
    return id === "xlabel" ? "X axis label" : id === "ylabel" ? "Y axis label" : id[0].toUpperCase() + id.slice(1);
  })();
  // FU-facet-hitmap: disambiguate which panel this is \u2014 every panel draws
  // its own "title"/"series:N", so the bare name alone ("Title") would be
  // ambiguous the moment more than one panel is on screen.
  return panel === undefined ? base : `Panel ${panel + 1} ${base.toLowerCase()}`;
};
/** F2.3b: a "series:N" hitbox becomes reachable once the canonical draft has
 *  per-series controls to open (`canonicalSeriesEditable`) -- legacy/detached
 *  sessions with nothing to edit keep the original "edited on Stage" wording
 *  unchanged, so every EXISTING PreviewOverlay caller/test is byte-identical.
 *  `panel` (FU-facet-hitmap, undefined for the flat path) suppresses the
 *  "double-click to edit" hint for a facet element -- see `isTextEditable`'s
 *  own doc for why that edit isn't wired. */
const elementTitle = (id: string, canonicalSeriesEditable: boolean, panel?: number) => {
  const name = elementName(id, panel);
  if (TEXT_ELEMENTS.has(id) && panel === undefined) {
    return `${name} \u2014 double-click to edit; right-click for properties`;
  }
  if (DRAGGABLE(id)) return `${name} \u2014 drag to move; right-click for properties`;
  if (id.startsWith("series:")) {
    return canonicalSeriesEditable
      ? `${name} \u2014 right-click for properties`
      : `${name} \u2014 properties are edited on Stage`;
  }
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
  /** Drop position in image pixels, followed by the PRESS ORIGIN (F2.4e) in
   *  the same space — a shape drag needs both to translate by the pointer's
   *  delta rather than jumping its reference point to the drop location. */
  onDragEnd: (id: string, px: number, py: number, startPx: number, startPy: number) => void;
  /** F2.3b: the canonical draft has per-series controls to open (the Series
   *  property group). Default false keeps every other/legacy caller's
   *  "properties are edited on Stage" hitbox exactly as before. */
  canonicalSeries?: boolean;
}) {
  // Hover/drag/context-menu tracking keys on `elementKey`, NOT the bare
  // `id` (FU-facet-hitmap) — two different facet panels each draw their own
  // "title"/"series:0", so keying on `id` alone would highlight/drag every
  // panel's matching element at once instead of just the one under the
  // pointer. `onSelect`/`onEditText`/`onDragEnd` (the caller's callbacks)
  // still receive the plain `id`, unchanged — those weren't panel-aware
  // before this element set existed and stay that way (see `isTextEditable`
  // and this file's own header for what's deferred).
  const [hover, setHover] = useState<string | null>(null);
  // FU-facet-hitmap fix round 3 (J1): `panel` joins `id` here — every other
  // per-element piece of state in this file already keys on the (id, panel)
  // pair (`elementKey`/`dragRef`/`dragPos`/`menu`), but `editing` was
  // missed, and a bare `map.elements.find((e) => e.id === editing.id)!`
  // both mispositioned the editor (a stale flat "title" edit would silently
  // snap onto a NEW facet response's panel-0 "title" box, since `find`
  // returns the first id match regardless of panel) and could throw outright
  // (an id with no match at all in the new `map.elements` — e.g. a "xlabel"
  // edit open when the next debounced render arrives with no x_label set).
  const [editing, setEditing] = useState<{ id: string; panel?: number; value: string } | null>(null);
  const [dragPos, setDragPos] = useState<{ key: string; dx: number; dy: number } | null>(null);
  const [menu, setMenu] = useState<{ id: string; panel?: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ key: string; id: string; startX: number; startY: number } | null>(null);

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
   *  (its input never blurs, so it would otherwise be silently discarded).
   *  Compares the (id, panel) PAIR (J1) -- re-opening the SAME element is a
   *  no-op, not a spurious commit-then-reopen. */
  const startTextEdit = (id: string, panel?: number) => {
    if (editing && (editing.id !== id || editing.panel !== panel)) onEditText(editing.id, editing.value);
    setEditing({ id, panel, value: textOf(id) });
  };
  // J1: the element `editing` refers to, re-resolved against the CURRENT
  // `map` every render (id AND panel must both match -- a bare id match
  // would let a stale flat "title" edit snap onto a facet response's
  // panel-0 "title" box). `null` when the element no longer exists in this
  // map (e.g. the hitmap changed shape mid-edit) -- the editor input below
  // simply doesn't render rather than dereferencing a missing box.
  const editingElement = editing
    ? (map.elements.find((e) => e.id === editing.id && e.panel === editing.panel) ?? null)
    : null;
  const menuItems = (id: string, panel?: number): ContextMenuItem[] => {
    const seriesEditable = id.startsWith("series:") && canonicalSeries;
    // FU-facet-hitmap fix round 2 (G3): a facet panel's own title has no
    // sound Properties… target either — same gate as `hasSoundTarget`,
    // inlined here since this function only has `id`/`panel`, not the full
    // `HitElement`. Without it the menu HEADER correctly said "Panel 2
    // title" while the enabled Properties… action still opened the whole
    // figure's Text & fonts panel underneath it.
    const panelTextElement = TEXT_ELEMENTS.has(id) && panel !== undefined;
    const group = panelTextElement ? null : groupForElement(id);
    const textEditable = TEXT_ELEMENTS.has(id) && panel === undefined;
    return [
      { header: elementName(id, panel) },
      group || seriesEditable
        ? { label: "Properties…", run: () => onSelect(id) }
        : id.startsWith("series:")
          ? { label: "Series properties — edit on Stage", disabled: true, run: () => {} }
          : { label: "Properties unavailable", disabled: true, run: () => {} },
      ...(textEditable ? [{ label: "Edit text…", run: () => startTextEdit(id, panel) }] : []),
    ];
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <img src={src} alt="figure preview" style={{ width: "100%", display: "block" }} />
      {map.elements.map((e, index) => {
        const key = elementKey(e);
        // FU-facet-hitmap fix round 3 (J3): a gated element (a facet
        // panel's own title -- no click/select/edit target, see
        // `hasSoundTarget`'s own doc) must not PRESENT as an interactive
        // control either -- no tabstop, no button role, no pointer cursor.
        // Right-click (the informative, fully-inert "Properties
        // unavailable" menu) and the plain hover outline stay either way;
        // neither implies "this is clickable" the way a tabbable button
        // does.
        const interactive = hasSoundTarget(e);
        return (
        <div
          key={key}
          data-element={e.id}
          data-panel={e.panel}
          title={elementTitle(e.id, canonicalSeries, e.panel)}
          {...(interactive ? { tabIndex: 0, role: "button", "aria-label": elementTitle(e.id, canonicalSeries, e.panel) } : {})}
          onPointerEnter={() => setHover(key)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(key)}
          onBlur={() => setHover((current) => (current === key ? null : current))}
          onClick={() => {
            if (interactive) onSelect(e.id);
          }}
          onDoubleClick={() => {
            if (isTextEditable(e)) startTextEdit(e.id, e.panel);
          }}
          onContextMenu={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            dragRef.current = null;
            setDragPos(null);
            setMenu({ id: e.id, panel: e.panel, x: ev.clientX, y: ev.clientY });
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              if (interactive) onSelect(e.id);
              return;
            }
            // Retrospective-audit P1 fix: a focused hitbox owns Delete and
            // bare arrows even though it has no action for them yet — an
            // unconsumed keystroke here reached the GLOBAL handlers and
            // removed/switched the active DATASET while the user was aiming
            // at a legend or annotation. No-op consume, same contract as the
            // map ROI/worksheet surfaces.
            if (ev.key === "Delete" || ev.key === "Backspace" || ev.key === "ArrowUp" || ev.key === "ArrowDown") {
              ev.preventDefault();
              return;
            }
            if (isContextMenuKeyEvent(ev)) {
              ev.preventDefault();
              const r = ev.currentTarget.getBoundingClientRect();
              setMenu({ id: e.id, panel: e.panel, x: r.left + r.width / 2, y: r.top + r.height / 2 });
            }
          }}
          onPointerDown={(ev) => {
            if (ev.button !== 0 || !DRAGGABLE(e.id)) return;
            dragRef.current = { key, id: e.id, startX: ev.clientX, startY: ev.clientY };
            // optional-chained: jsdom has no pointer capture
            (ev.target as Element).setPointerCapture?.(ev.pointerId);
          }}
          onPointerMove={(ev) => {
            const d = dragRef.current;
            if (!d || d.key !== key) return;
            setDragPos({ key, dx: ev.clientX - d.startX, dy: ev.clientY - d.startY });
          }}
          onPointerUp={(ev) => {
            const d = dragRef.current;
            dragRef.current = null;
            setDragPos(null);
            if (!d || d.key !== key) return;
            const moved =
              Math.abs(ev.clientX - d.startX) + Math.abs(ev.clientY - d.startY) > 3;
            if (!moved) return; // a plain click — selection already handled
            const [px, py] = toImagePx(ev.clientX, ev.clientY);
            const [startPx, startPy] = toImagePx(d.startX, d.startY);
            onDragEnd(e.id, px, py, startPx, startPy);
          }}
          style={{
            position: "absolute",
            ...pct(e),
            zIndex: hitboxZIndex(map.elements, e, index),
            cursor: DRAGGABLE(e.id) ? "move" : interactive ? "pointer" : "default",
            outline:
              hover === key ? "1.5px solid var(--accent)" : "1px solid transparent",
            borderRadius: 2,
            transform:
              dragPos?.key === key
                ? `translate(${dragPos.dx}px, ${dragPos.dy}px)`
                : undefined,
          }}
        />
        );
      })}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.id, menu.panel)}
          onClose={() => setMenu(null)}
        />
      )}
      {editing && editingElement && (
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
            ...pct(editingElement),
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
