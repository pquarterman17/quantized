// One panel inset (#15): a movable/resizable box over the main plot showing
// another dataset's columns, an image, or a small table. Generalizes the
// magnifier inset's "floating box tracked to the main plot's frame" family
// (`InsetPlot.tsx`) but much simpler: no source region, no zoomable child
// uPlot, no connector lines -- a panel inset owns its own self-contained
// content, so `at` IS the box's content rect (no header-chrome gutter to
// measure), matching the export's `ax.inset_axes(at)` bounds exactly.
//
// The dataset-kind preview is a small hand-rolled SVG line chart, not a full
// interactive uPlot: the content is a frozen snapshot (never zoomed/panned
// on screen), and a second uPlot-backed lazy chunk would duplicate what the
// magnifier inset already pulls in for no interactive benefit.

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type uPlot from "uplot";
import { insetBoxRect, movedAt, resizedAt, type PxRect } from "../../lib/inset";
import type { PanelInset } from "../../lib/panelInset";
import { useApp } from "../../store/useApp";
import PanelInsetContentView from "./PanelInsetContentView";

interface Props {
  inset: PanelInset;
  plotRef?: RefObject<uPlot | null>;
}

const NO_GUTTERS = { l: 0, t: 0, r: 0, b: 0 };

export default function PanelInsetBox({ inset, plotRef }: Props) {
  const selected = useApp((s) => s.selectedPanelInsetId === inset.id);
  const setSelected = useApp((s) => s.setSelectedPanelInsetId);
  const updatePanelInset = useApp((s) => s.updatePanelInset);
  const removePanelInset = useApp((s) => s.removePanelInset);

  const boxRef = useRef<HTMLDivElement>(null);
  const atRef = useRef<PanelInset["at"]>(inset.at);
  const dragRef = useRef<{ x: number; y: number; at: PanelInset["at"]; mode: "move" | "size" } | null>(null);
  const frameRef = useRef<PxRect | null>(null);
  if (!dragRef.current) atRef.current = inset.at;

  // Track the main plot's frame every frame, like InsetPlot's own tick loop
  // -- the main plot can zoom/pan/resize without telling this overlay.
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const box = boxRef.current;
      const main = plotRef?.current;
      const stage = box?.parentElement;
      if (!box || !stage) return;
      const fr = main?.over?.getBoundingClientRect();
      if (!main || !fr?.width || !fr.height) return;
      const sr = stage.getBoundingClientRect();
      const frame = { left: fr.left - sr.left, top: fr.top - sr.top, width: fr.width, height: fr.height };
      frameRef.current = frame;
      const r = insetBoxRect(frame, atRef.current, NO_GUTTERS);
      const key = JSON.stringify(r);
      if (key === last) return;
      last = key;
      Object.assign(box.style, {
        left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
        right: "auto", bottom: "auto",
      });
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [plotRef]);

  const startDrag = (mode: "move" | "size") => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(inset.id);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, at: atRef.current, mode };
  };
  const onDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    const frame = frameRef.current;
    if (!d || !frame) return;
    const move = d.mode === "move" ? movedAt : resizedAt;
    const next = move(d.at, frame, e.clientX - d.x, e.clientY - d.y);
    atRef.current = next;
    const box = boxRef.current;
    if (box) {
      const r = insetBoxRect(frame, next, NO_GUTTERS);
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    }
  };
  const endDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (JSON.stringify(atRef.current) !== JSON.stringify(d.at)) {
      updatePanelInset(inset.id, { at: atRef.current });
    }
  };
  const dragProps = (mode: "move" | "size") => ({
    onPointerDown: startDrag(mode), onPointerMove: onDrag, onPointerUp: endDrag, onPointerCancel: endDrag,
  });

  return (
    <div
      ref={boxRef}
      data-testid="panel-inset-box"
      data-panel-inset-id={inset.id}
      onClick={(e) => {
        e.stopPropagation();
        setSelected(inset.id);
      }}
      style={{ position: "absolute" }}
    >
      {/* Content gets its own clipped layer -- the header strip below sits at
          a NEGATIVE top (above the box), so clipping must not apply to this
          outer positioned div or the header becomes unhittable (found live:
          a drag-to-move gesture never reached startDrag at all). */}
      <div
        className="qzk-glass"
        style={{
          position: "absolute",
          inset: 0,
          border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        <PanelInsetContentView content={inset.content} />
      </div>
      {selected && (
        <>
          <div
            {...dragProps("move")}
            title="Drag to move."
            style={{
              position: "absolute", left: 0, right: 0, top: -20, height: 18,
              display: "flex", justifyContent: "flex-end", alignItems: "center",
              background: "var(--surface-2)", border: "1px solid var(--accent)", fontSize: 10, cursor: "move",
            }}
          >
            <button
              type="button"
              aria-label="Delete panel inset"
              title="Delete"
              className="qzk-tool-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                removePanelInset(inset.id);
              }}
            >
              ×
            </button>
          </div>
          <div
            {...dragProps("size")}
            aria-label="Resize panel inset"
            title="Drag to resize."
            style={{ position: "absolute", right: 0, bottom: 0, width: 10, height: 10, cursor: "nwse-resize" }}
          />
        </>
      )}
    </div>
  );
}
