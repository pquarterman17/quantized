// Adapted from fermiviewer frontend/src/components/overlays/ToolWindow.tsx.
// Draggable floating workshop window. Decoupled from any store: it owns its
// position + focus z-order locally, so any feature can mount one without
// store plumbing. Uses the kit's qzk-win* frame (shell.css).

import { useRef, useState, type ReactNode } from "react";

let zTop = 0;

export default function ToolWindow({
  title,
  x = 120,
  y = 90,
  width = 360,
  onClose,
  children,
}: {
  title: ReactNode;
  x?: number;
  y?: number;
  width?: number;
  onClose?: () => void;
  children: ReactNode;
}) {
  const [pos, setPos] = useState({ x, y });
  const [z, setZ] = useState(() => ++zTop);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const onTitleDown = (e: React.PointerEvent) => {
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onTitleMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPos({
      x: Math.max(0, e.clientX - dragRef.current.dx),
      y: Math.max(0, e.clientY - dragRef.current.dy),
    });
  };
  const onTitleUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className="qzk-glass qzk-win"
      style={{ left: pos.x, top: pos.y, zIndex: 200 + z, width }}
      onMouseDown={() => setZ(++zTop)}
    >
      <div
        className="qzk-win-title"
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
      >
        {onClose && (
          <button
            className="qzk-win-close"
            title="Close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
          />
        )}
        <span className="grow">{title}</span>
      </div>
      <div className="qzk-win-body">{children}</div>
    </div>
  );
}
