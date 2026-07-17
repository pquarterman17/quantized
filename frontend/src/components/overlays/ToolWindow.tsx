// Adapted from fermiviewer frontend/src/components/overlays/ToolWindow.tsx.
// Draggable floating workshop window. GUI_INTERACTION_PLAN #10 ("floating
// workshops recoverable") lifted its geometry (position/size/collapsed) out
// of local `useState` into store/toolwindows.ts, keyed by the now-required
// `id` prop — a window survives close/reopen, round-trips through the .dwk
// workspace, and the View-menu "Reset window positions" command (commands/
// uiCommands.ts) can reach every open-or-ever-opened window from one place.
// Content/open-flag ownership still lives entirely in each workshop's own
// store field — only geometry moved here. Uses the kit's qzk-win* frame
// (shell.css).
//
// Recoverability (#10 item 1): the ENTIRE title bar — not just the top-left
// corner — is clamped inside the viewport on drag end and on every window
// resize (a monitor unplug is the classic loss scenario), so a window can
// never end up with its grab handle unreachable.

import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  clampToolWindowPos,
  defaultToolWindowLayout,
  MIN_HEIGHT,
  MIN_WIDTH,
  TITLE_BAR_HEIGHT,
} from "../../lib/toolwindow";
import { useApp } from "../../store/useApp";

let zTop = 0;

export default function ToolWindow({
  id,
  title,
  x = 120,
  y = 90,
  width = 360,
  onClose,
  children,
}: {
  /** Stable identity for the persisted-layout registry (store/toolwindows.ts)
   *  — e.g. "baseline", "curvefit", "report". Must be unique across every
   *  concurrently-mountable ToolWindow (most workshops mount at most one
   *  instance at a time, so their own name is a natural id). */
  id: string;
  title: ReactNode;
  x?: number;
  y?: number;
  width?: number;
  onClose?: () => void;
  children: ReactNode;
}) {
  const stored = useApp((s) => s.toolWindowLayout[id]);
  const setLayout = useApp((s) => s.setToolWindowLayout);
  const toggleCollapsed = useApp((s) => s.toggleToolWindowCollapsed);
  const fallback = defaultToolWindowLayout(x, y, width);
  const layout = stored ?? fallback;

  const [z, setZ] = useState(() => ++zTop);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const winRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);

  const clampNow = (nx: number, ny: number, w: number) => {
    const th = titleRef.current?.offsetHeight ?? TITLE_BAR_HEIGHT;
    return clampToolWindowPos(nx, ny, w, th, { width: window.innerWidth, height: window.innerHeight });
  };

  // Re-clamp on viewport resize (monitor unplug — the classic loss scenario)
  // and once on mount (covers a window whose position predates a later
  // browser/monitor resize; a freshly-restored .dwk is already clamped by
  // lib/workspace.ts's sanitizeToolWindowLayout, but this stays correct even
  // for a window that never went through that path). Reads/writes the store
  // directly (not the `layout` closure) so it always acts on the latest value.
  useEffect(() => {
    const reclamp = () => {
      const current = useApp.getState().toolWindowLayout[id] ?? fallback;
      const clamped = clampNow(current.x, current.y, current.width);
      if (clamped.x !== current.x || clamped.y !== current.y) {
        setLayout(id, { ...current, ...clamped });
      }
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onTitleDown = (e: React.PointerEvent) => {
    dragRef.current = { dx: e.clientX - layout.x, dy: e.clientY - layout.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onTitleMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setLayout(id, { ...layout, x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy });
  };
  const onTitleUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    const current = useApp.getState().toolWindowLayout[id] ?? layout;
    setLayout(id, { ...current, ...clampNow(current.x, current.y, current.width) });
  };

  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // never also starts a title-bar drag
    resizeRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: layout.width,
      h: layout.height ?? winRef.current?.offsetHeight ?? MIN_HEIGHT,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    setLayout(id, {
      ...layout,
      width: Math.max(MIN_WIDTH, r.w + (e.clientX - r.x)),
      height: Math.max(MIN_HEIGHT, r.h + (e.clientY - r.y)),
    });
  };
  const onResizeUp = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    const current = useApp.getState().toolWindowLayout[id] ?? layout;
    setLayout(id, { ...current, ...clampNow(current.x, current.y, current.width) });
  };

  const onCollapseToggle = () => toggleCollapsed(id, fallback);

  return (
    <div
      ref={winRef}
      className="qzk-glass qzk-win"
      style={{
        left: layout.x,
        top: layout.y,
        zIndex: 200 + z,
        width: layout.width,
        height: layout.collapsed ? undefined : (layout.height ?? undefined),
      }}
      onMouseDown={() => setZ(++zTop)}
    >
      <div
        ref={titleRef}
        className="qzk-win-title"
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
        onDoubleClick={onCollapseToggle}
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
        <button
          className="qzk-win-collapse"
          title={layout.collapsed ? "Expand" : "Collapse"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onCollapseToggle}
        >
          {layout.collapsed ? "▸" : "▾"}
        </button>
      </div>
      {!layout.collapsed && (
        <>
          <div className="qzk-win-body">{children}</div>
          <div
            className="qzk-win-resize"
            aria-hidden="true"
            title="Resize"
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
          />
        </>
      )}
    </div>
  );
}
