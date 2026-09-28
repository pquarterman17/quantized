import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { useApp } from "../../store/useApp";

export type LegendResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export interface LegendRect { left: number; top: number; width: number; height: number }

const HANDLES: readonly LegendResizeEdge[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const MIN_W = 96;
const MIN_H = 40;
const DRAG_THRESHOLD = 3;
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Resize one or two edges while keeping the opposite edges fixed. */
export function resizeLegendRect(
  start: LegendRect,
  edge: LegendResizeEdge,
  dx: number,
  dy: number,
  bounds: { width: number; height: number },
): LegendRect {
  const minW = Math.min(MIN_W, bounds.width);
  const minH = Math.min(MIN_H, bounds.height);
  const startLeft = clamp(start.left, 0, Math.max(0, bounds.width - minW));
  const startTop = clamp(start.top, 0, Math.max(0, bounds.height - minH));
  let left = startLeft;
  let top = startTop;
  let right = clamp(start.left + start.width, startLeft + minW, bounds.width);
  let bottom = clamp(start.top + start.height, startTop + minH, bounds.height);
  if (edge.includes("w")) left = clamp(startLeft + dx, 0, right - minW);
  if (edge.includes("e")) right = clamp(right + dx, left + minW, bounds.width);
  if (edge.includes("n")) top = clamp(startTop + dy, 0, bottom - minH);
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + minH, bounds.height);
  return { left, top, width: right - left, height: bottom - top };
}

interface Gesture {
  edge: LegendResizeEdge;
  pointerId: number;
  x: number;
  y: number;
  start: LegendRect;
  bounds: { width: number; height: number };
  original: { left: string; top: string; right: string; bottom: string; width: string; height: string };
  latest: LegendRect | null;
}

interface Props { boxRef: RefObject<HTMLDivElement | null> }

export default function LegendResizeHandles({ boxRef }: Props) {
  const setLegendBounds = useApp((s) => s.setLegendBounds);
  const setLegendSize = useApp((s) => s.setLegendSize);
  const legendSize = useApp((s) => s.legendSize);
  const gestureRef = useRef<Gesture | null>(null);
  const previewRafRef = useRef<number | null>(null);

  const cancelPreview = () => {
    if (previewRafRef.current !== null) cancelAnimationFrame(previewRafRef.current);
    previewRafRef.current = null;
  };

  useEffect(() => () => {
    cancelPreview();
    const gesture = gestureRef.current;
    if (gesture && boxRef.current) Object.assign(boxRef.current.style, gesture.original);
    gestureRef.current = null;
  }, [boxRef]);

  const onStart = (edge: LegendResizeEdge, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const box = boxRef.current;
    const parent = box?.parentElement;
    if (!box || !parent) return;
    const rect = box.getBoundingClientRect();
    const bounds = parent.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    gestureRef.current = {
      edge, pointerId: e.pointerId, x: e.clientX, y: e.clientY,
      start: { left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height },
      bounds: { width: bounds.width, height: bounds.height }, latest: null,
      original: {
        left: box.style.left, top: box.style.top, right: box.style.right,
        bottom: box.style.bottom, width: box.style.width, height: box.style.height,
      },
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent) => {
    const gesture = gestureRef.current;
    const box = boxRef.current;
    if (!gesture || !box || gesture.pointerId !== e.pointerId) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    const next = resizeLegendRect(
      gesture.start, gesture.edge, dx, dy, gesture.bounds,
    );
    gesture.latest = next;
    if (previewRafRef.current === null) previewRafRef.current = requestAnimationFrame(() => {
      previewRafRef.current = null;
      const latest = gestureRef.current?.latest;
      if (!latest || !boxRef.current) return;
      Object.assign(boxRef.current.style, {
        left: `${latest.left}px`, top: `${latest.top}px`, right: "auto", bottom: "auto",
        width: `${latest.width}px`, height: `${latest.height}px`,
      });
    });
  };

  const finish = (e: ReactPointerEvent, commit: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    cancelPreview();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (commit && gesture.latest) {
      setLegendBounds(
        [gesture.latest.left / gesture.bounds.width, gesture.latest.top / gesture.bounds.height],
        [gesture.latest.width, gesture.latest.height],
      );
    } else if (boxRef.current) Object.assign(boxRef.current.style, gesture.original);
  };

  return HANDLES.map((edge) => (
    <span
      key={edge}
      className={`qzk-legend-resize qzk-legend-resize-${edge}`}
      aria-hidden="true"
      title={`Resize legend (${edge}) · double-click to fit contents`}
      onPointerDown={(event) => onStart(edge, event)}
      onPointerMove={onMove}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onLostPointerCapture={(event) => finish(event, false)}
      onDoubleClick={() => { if (legendSize) setLegendSize(null); }}
    />
  ));
}
