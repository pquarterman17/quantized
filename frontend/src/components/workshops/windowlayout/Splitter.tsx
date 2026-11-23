// A focusable splitter between two layout regions or two stacked windows
// (WORKSPACE_LAYOUT_PLAN P1). Dragging shows a guide at the new position and
// commits once on release (one layout write per gesture, not one per
// pointermove); the arrow keys move it by SPLIT_STEP px (Shift: 1 px) and
// commit at once. `onCommit` receives the signed px delta along the axis.

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { SPLIT_STEP } from "./layoutGeometry";

export default function Splitter({
  axis,
  label,
  value,
  valueText,
  range,
  onCommit,
}: {
  /** "x": a vertical bar dragged left/right; "y": a horizontal bar dragged up/down. */
  axis: "x" | "y";
  label: string;
  /** The size the splitter controls, in px, for `aria-valuenow`. */
  value?: number;
  /** What `value` means in words ("Style 60%, Data 40%"), read instead of the bare number. */
  valueText?: string;
  /** aria-valuemin / aria-valuemax of `value`. */
  range?: [number, number];
  onCommit: (delta: number) => void;
}) {
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  const at = (e: PointerEvent) => (axis === "x" ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    start.current = at(e);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (start.current !== null) setDrag(at(e) - start.current);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (start.current === null) return;
    const delta = at(e) - start.current;
    start.current = null;
    setDrag(0);
    if (delta !== 0) onCommit(delta);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const keys = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    const dir = keys.indexOf(e.key);
    if (dir < 0) return;
    e.preventDefault();
    onCommit((dir === 0 ? -1 : 1) * (e.shiftKey ? 1 : SPLIT_STEP));
  };

  return (
    <div
      className={`qzk-wl-split qzk-wl-split-${axis}${drag ? " dragging" : ""}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={value}
      aria-valuemin={value === undefined ? undefined : range?.[0]}
      aria-valuemax={value === undefined ? undefined : range?.[1]}
      aria-valuetext={valueText}
      style={drag ? { transform: axis === "x" ? `translateX(${drag}px)` : `translateY(${drag}px)` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => ((start.current = null), setDrag(0))}
      onKeyDown={onKeyDown}
    />
  );
}
