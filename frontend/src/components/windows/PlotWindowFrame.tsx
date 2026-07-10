// The MDI chrome around one plot window's content (MULTI_PLOT_PLAN item 3):
// a draggable title bar (window title + dataset badge), a resize grip, a
// close button, and a focus highlight using `--accent`. Geometry/z mutations
// flow through the existing store actions (moveWindow/resizeWindow/
// raiseWindow/focusWindow — Key Decision 3), rAF-throttled so a fast native
// drag doesn't fire a store update (and a React re-render) per pointermove.
//
// Item 8 adds double-click-the-title-BAR to toggle maximize/restore (the
// Origin habit); item 10 adds double-click-the-title-TEXT to rename inline
// (DatasetRow/FolderRow's pattern) and a channel-count/rows badge next to
// the existing dataset-name badge. The two double-clicks don't collide: the
// title text's own handler stops propagation, so a double-click that starts
// on the editable text never also reaches the title bar's maximize toggle.
//
// A separate component from `overlays/ToolWindow` (the 24-consumer workshop
// floating panel): that one is deliberately store-decoupled with fixed width
// and no resize/persistence; this one is store-controlled geometry with
// resize, because plot windows need it and workshops don't (Key Decision 3).
// It shares the `qzk-win*` naming FAMILY (see shell.css) under a distinct
// `qzk-plotwin*` prefix so the two don't collide in the stylesheet.

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import {
  nextPlotBg,
  snapMovePosition,
  snapResizeSize,
  type PlotBg,
  type PlotWindow,
  type WindowGeometry,
} from "../../lib/plotview";
import { resolvePlotBg } from "../../lib/uplotOpts";
import { useApp } from "../../store/useApp";
import { Badge } from "../primitives";

/** Tooltip label per background mode (item 18's title-bar toggle). */
const BG_LABEL: Record<PlotBg, string> = { theme: "Theme", light: "Light", dark: "Dark" };

export interface PlotWindowFrameProps {
  win: PlotWindow;
  focused: boolean;
  /** Dataset display name for the title-bar badge (undefined = unbound /
   *  removed dataset — see MULTI_PLOT_PLAN decision #4). */
  datasetName: string | undefined;
  /** Channel-count/row-count for the item-10 mono badge (undefined = unbound
   *  window, matching `datasetName`). */
  datasetMeta?: { channels: number; rows: number };
  /** The hosting canvas's current size (from `WindowCanvas`'s own
   *  ResizeObserver) — used to keep the title bar reachable (never fully
   *  off-canvas), both live while dragging and reactively when the canvas
   *  itself resizes. Undefined (e.g. in isolation/tests) skips clamping. */
  bounds?: { width: number; height: number };
  children: ReactNode;
}

const MIN_W = 240;
const MIN_H = 160;
// A dragged/reflowed window always keeps at least this much of its title bar
// on-canvas, so it's never lost off-screen (item 3's "geometry clamped to
// the canvas" requirement).
const TITLE_MIN_VISIBLE = 80;
const TITLEBAR_H = 28;

/** Clamp a title-bar-reachable position into `bounds` (no-op without bounds). */
function clampPos(x: number, y: number, bounds: { width: number; height: number } | undefined) {
  if (!bounds) return { x: Math.max(0, x), y: Math.max(0, y) };
  return {
    x: Math.min(Math.max(0, x), Math.max(0, bounds.width - TITLE_MIN_VISIBLE)),
    y: Math.min(Math.max(0, y), Math.max(0, bounds.height - TITLEBAR_H)),
  };
}

type DragMode = "move" | "resize";
interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  /** Sibling snap targets (item 12) — captured once per gesture. */
  siblings: WindowGeometry[];
}

export default function PlotWindowFrame({
  win,
  focused,
  datasetName,
  datasetMeta,
  bounds,
  children,
}: PlotWindowFrameProps) {
  const moveWindow = useApp((s) => s.moveWindow);
  const resizeWindow = useApp((s) => s.resizeWindow);
  const focusWindow = useApp((s) => s.focusWindow);
  const closeWindow = useApp((s) => s.closeWindow);
  const toggleMaximizeWindow = useApp((s) => s.toggleMaximizeWindow);
  const renameWindow = useApp((s) => s.renameWindow);
  const setWindowBg = useApp((s) => s.setWindowBg);

  // Item 10: double-click the title TEXT (not the bar) to rename inline —
  // null = not editing (DatasetRow/FolderRow's own inline-rename pattern).
  const [renaming, setRenaming] = useState<string | null>(null);
  const displayTitle = win.title || datasetName || "Untitled graph";
  // Item 18: this window's own background override, resolved to a concrete
  // colour for the body's inline style — the SAME chokepoint `buildOpts`
  // uses for canvas draw colours (`lib/uplotOpts.ts`'s `resolvePlotBg`).
  const { axesBg } = resolvePlotBg(win.bg);
  const commitRename = () => {
    if (renaming != null && renaming.trim()) renameWindow(win.id, renaming.trim());
    setRenaming(null);
  };

  // Canvas-resize reflow: whenever the hosting canvas changes size, re-clamp
  // this window's position so its title bar stays reachable (a browser-
  // window shrink can otherwise strand a window's grab handle off-canvas).
  useEffect(() => {
    if (!bounds || win.winState === "maximized") return;
    const clamped = clampPos(win.geometry.x, win.geometry.y, bounds);
    if (clamped.x !== win.geometry.x || clamped.y !== win.geometry.y) {
      moveWindow(win.id, clamped.x, clamped.y);
    }
    // Only re-run when the CANVAS resizes or this window's identity changes —
    // not on every geometry tick (that would fight live dragging).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds?.width, bounds?.height, win.id, win.winState]);

  // rAF-throttled drag/resize: the native pointermove handler just records the
  // latest pointer position; a single rAF callback flushes it into the store,
  // so a fast drag fires at most one store update (React re-render) per frame
  // instead of one per native mousemove. `scheduledRef` (not `rafIdRef`) is
  // the "is a flush pending" gate — kept separate from the cancellation
  // handle so a synchronous `requestAnimationFrame` (real browsers never do
  // this; a test stub might) can't have its own reset-to-null clobbered by
  // the outer `rafIdRef.current = requestAnimationFrame(...)` assignment
  // completing (in real order) AFTER the callback already ran.
  const dragRef = useRef<DragState | null>(null);
  const pendingRef = useRef<{ a: number; b: number } | null>(null);
  const scheduledRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    scheduledRef.current = false;
    rafIdRef.current = null;
    const pending = pendingRef.current;
    const drag = dragRef.current;
    if (!pending || !drag) return;
    if (drag.mode === "move") moveWindow(win.id, pending.a, pending.b);
    else resizeWindow(win.id, pending.a, pending.b);
  }, [win.id, moveWindow, resizeWindow]);

  const schedule = useCallback(
    (a: number, b: number) => {
      pendingRef.current = { a, b };
      if (!scheduledRef.current) {
        scheduledRef.current = true;
        rafIdRef.current = requestAnimationFrame(flush);
      }
    },
    [flush],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      // Item 12: snap to canvas + sibling edges while dragging; holding Alt
      // bypasses it (the WM convention). Math lives in lib/plotview.
      if (drag.mode === "move") {
        let x = drag.origX + dx;
        let y = drag.origY + dy;
        if (!e.altKey) {
          ({ x, y } = snapMovePosition({ x, y, w: drag.origW, h: drag.origH }, bounds, drag.siblings));
        }
        const p = clampPos(x, y, bounds);
        schedule(p.x, p.y);
      } else {
        let w = Math.max(MIN_W, drag.origW + dx);
        let h = Math.max(MIN_H, drag.origH + dy);
        if (!e.altKey) {
          const s = snapResizeSize({ x: drag.origX, y: drag.origY, w, h }, bounds, drag.siblings);
          w = Math.max(MIN_W, s.w);
          h = Math.max(MIN_H, s.h);
        }
        schedule(w, h);
      }
    },
    [schedule, bounds],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  useEffect(
    () => () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    },
    [onPointerMove, onPointerUp],
  );

  const beginDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origX: win.geometry.x,
      origY: win.geometry.y,
      origW: win.geometry.w,
      origH: win.geometry.h,
      // Every OTHER visible window's rect — read non-subscribing (getState)
      // so the drag handlers never re-bind mid-gesture (siblings can't move
      // during OUR drag anyway).
      siblings: useApp
        .getState()
        .plotWindows.filter((w) => w.id !== win.id && w.winState !== "minimized")
        .map((w) => w.geometry),
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // Any pointer activity anywhere in the frame (title bar, body, grip) raises
  // + focuses it first — the item-4 "background frames focus on pointerdown"
  // contract, implemented ONCE here (capture phase, so it runs before uPlot's
  // own native mousedown listeners on the canvas beneath — capture visits
  // this ancestor on the way down, before the event ever reaches the target).
  const onFrameCapture = () => {
    if (!focused) focusWindow(win.id);
  };

  const maximized = win.winState === "maximized";
  const style: React.CSSProperties = maximized
    ? { position: "absolute", inset: 0 }
    : {
        position: "absolute",
        left: win.geometry.x,
        top: win.geometry.y,
        width: win.geometry.w,
        height: win.geometry.h,
        zIndex: win.z,
      };

  // A right-click on a BACKGROUND window only focuses it (via the pointerdown
  // capture above) — the focused window's own PlotStage owns the plot context
  // menu. Suppress the native browser menu here so a background right-click
  // never flashes one before/around the focus swap. A focused window is left
  // alone: PlotStage (or the title bar) manages its own contextmenu.
  const onFrameContextMenu = (e: React.MouseEvent) => {
    if (!focused) e.preventDefault();
  };

  return (
    <div
      className={`qzk-plotwin${focused ? " focused" : ""}`}
      style={style}
      onPointerDownCapture={onFrameCapture}
      onContextMenuCapture={onFrameContextMenu}
    >
      <div
        className="qzk-plotwin-titlebar"
        onPointerDown={beginDrag("move")}
        onDoubleClick={() => toggleMaximizeWindow(win.id)}
      >
        {renaming != null ? (
          <input
            className="qz-input qzk-plotwin-rename"
            autoFocus
            value={renaming}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <span
            className="qzk-plotwin-title"
            title={`${displayTitle} — double-click to rename`}
            onDoubleClick={(e) => {
              e.stopPropagation(); // renames, never also toggles maximize
              setRenaming(displayTitle);
            }}
          >
            {displayTitle}
          </span>
        )}
        {datasetName && <span className="qzk-plotwin-badge">{datasetName}</span>}
        {datasetMeta && (
          <Badge tone="accent" className="qzk-plotwin-meta">
            {datasetMeta.channels}ch · {datasetMeta.rows}pts
          </Badge>
        )}
        <button
          type="button"
          className="qzk-plotwin-bg"
          title={`Window background: ${BG_LABEL[win.bg]} — click to cycle (Theme / Light / Dark)`}
          aria-label="Cycle window background"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setWindowBg(win.id, nextPlotBg(win.bg))}
        >
          ◐
        </button>
        <button
          type="button"
          className="qzk-plotwin-close"
          aria-label="Close window"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => closeWindow(win.id)}
        />
      </div>
      <div
        className="qzk-plotwin-body"
        style={win.bg !== "theme" ? { background: axesBg } : undefined}
      >
        {children}
      </div>
      {!maximized && (
        <div
          className="qzk-plotwin-resize"
          aria-hidden="true"
          onPointerDown={beginDrag("resize")}
        />
      )}
    </div>
  );
}
