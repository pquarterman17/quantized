// A floating ToolWindow's bottom-right resize grip (split out of
// ToolWindow.tsx for the component ceiling): a pointer drag sets an explicit
// width and height, never below MIN_WIDTH x MIN_HEIGHT, and the release
// re-clamps the position exactly as a title-bar drag end does.

import { useRef, type PointerEvent, type RefObject } from "react";

import { MIN_HEIGHT, MIN_WIDTH, type ToolWindowLayout } from "../../lib/toolwindow";
import { useApp } from "../../store/useApp";

export default function ToolWindowResizeGrip({
  id,
  layout,
  frame,
  onEnd,
}: {
  id: string;
  layout: ToolWindowLayout;
  frame: RefObject<HTMLDivElement | null>;
  /** The release: re-clamp the latest stored layout (ToolWindow). */
  onEnd: () => void;
}) {
  const setLayout = useApp((s) => s.setToolWindowLayout);
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const onDown = (e: PointerEvent) => {
    e.stopPropagation(); // never also starts a title-bar drag
    resizeRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: layout.width,
      h: layout.height ?? frame.current?.offsetHeight ?? MIN_HEIGHT,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    setLayout(id, {
      ...layout,
      width: Math.max(MIN_WIDTH, r.w + (e.clientX - r.x)),
      height: Math.max(MIN_HEIGHT, r.h + (e.clientY - r.y)),
    });
  };
  const onUp = (e: PointerEvent) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    onEnd();
  };

  return <div className="qzk-win-resize" aria-hidden="true" title="Resize" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />;
}
