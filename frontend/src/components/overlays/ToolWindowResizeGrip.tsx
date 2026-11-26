// A floating ToolWindow's resize handles (split out of ToolWindow.tsx for the
// component ceiling): the visible bottom-right grip plus invisible edge and
// corner handles on the other seven sides, so the window can be resized from
// any edge like a plot window. A pointer drag persists the geometry in the
// store (toolWindowLayout), clamps it to the viewport and to MIN_WIDTH x
// MIN_HEIGHT (resizeToolWindow), and the release re-clamps the position exactly
// as a title-bar drag end does. The keyboard twin is Shift+arrows on the title bar.

import { useRef, type PointerEvent } from "react";

import { MIN_HEIGHT, MIN_WIDTH, resizeToolWindow, type ToolResizeEdge, type ToolWindowLayout } from "../../lib/toolwindow";
import { useApp } from "../../store/useApp";

const EDGES: ToolResizeEdge[] = ["se", "n", "e", "s", "w", "ne", "nw", "sw"];

export default function ToolWindowResizeGrip({
  id,
  layout,
  frame,
  onEnd,
}: {
  id: string;
  layout: ToolWindowLayout;
  frame: React.RefObject<HTMLDivElement | null>;
  /** The release: re-clamp the latest stored layout (ToolWindow). */
  onEnd: () => void;
}) {
  const setLayout = useApp((s) => s.setToolWindowLayout);
  const resizeRef = useRef<{ px: number; py: number; edge: ToolResizeEdge; minW: number; box: { x: number; y: number; width: number; height: number } } | null>(null);

  const onDown = (edge: ToolResizeEdge) => (e: PointerEvent) => {
    e.stopPropagation(); // never also starts a title-bar drag
    const height = layout.height ?? (frame.current?.offsetHeight || MIN_HEIGHT);
    // A frame whose title bar needs more room (the layout's dock buttons) says so with a CSS min-width.
    const minW = Math.max(MIN_WIDTH, parseFloat(frame.current ? getComputedStyle(frame.current).minWidth : "") || 0);
    resizeRef.current = { px: e.clientX, py: e.clientY, edge, minW, box: { x: layout.x, y: layout.y, width: layout.width, height } };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const next = resizeToolWindow(r.box, r.edge, e.clientX - r.px, e.clientY - r.py, { width: window.innerWidth, height: window.innerHeight }, r.minW);
    setLayout(id, { ...layout, ...next });
  };
  const onUp = (e: PointerEvent) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    onEnd();
  };

  return (
    <>
      {EDGES.map((edge) => (
        <div
          key={edge}
          className={edge === "se" ? "qzk-win-resize" : `qzk-win-edge qzk-win-edge-${edge}`}
          data-resize-edge={edge}
          aria-hidden="true"
          title={edge === "se" ? "Resize" : undefined}
          onPointerDown={onDown(edge)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      ))}
    </>
  );
}
