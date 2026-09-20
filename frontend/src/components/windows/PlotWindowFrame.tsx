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
// floating panel — GUI_INTERACTION_PLAN #10 gave it its OWN store-backed
// geometry in store/toolwindows.ts, distinct from this MDI plot-window
// slice): the two live in unrelated stores because a workshop's identity is
// its `id` prop (stable across close/reopen) while a plot window's identity
// is a generated `PlotWindow.id` (MULTI_PLOT_PLAN's window-management
// model) — different lifecycles, different clamp/snap rules (this one snaps
// to siblings + the canvas; ToolWindow clamps its title bar to the
// viewport). It shares the `qzk-win*` naming FAMILY (see shell.css) under a
// distinct `qzk-plotwin*` prefix so the two don't collide in the stylesheet.

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { type PlotWindow, type WindowGeometry } from "../../lib/plotview";
import { resolvePlotBg } from "../../lib/uplotOpts";
import { snapMovePosition, snapResizeSize } from "../../lib/windowSnap";
import { useApp } from "../../store/useApp";
import { useWindowsStore } from "../../store/hooks/useWindowsStore";
import { DATASET_DND } from "../Library/dnd";
import { Badge } from "../primitives";
import WindowTitleButtons from "./WindowTitleButtons";

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
  siblings: WindowGeometry[];
  historyRecorded: boolean;
}

const END_GESTURE_EVENTS = ["pointerup", "pointercancel", "blur"] as const;

export default function PlotWindowFrame({
  win,
  focused,
  datasetName,
  datasetMeta,
  bounds,
  children,
}: PlotWindowFrameProps) {
  const moveWindow = useWindowsStore((s) => s.moveWindow);
  const resizeWindow = useWindowsStore((s) => s.resizeWindow);
  const focusWindow = useWindowsStore((s) => s.focusWindow);
  const toggleMaximizeWindow = useWindowsStore((s) => s.toggleMaximizeWindow);
  const renameWindow = useWindowsStore((s) => s.renameWindow);
  const rebindWindow = useWindowsStore((s) => s.rebindWindow);
  const activeDrag = useApp((s) => s.activeDrag);

  // Item 14: this frame is a drop target for a Library dataset drag
  // (DATASET_DND — the SAME dataTransfer type DatasetRow sets, so a row
  // dragged over a window and a row dragged over a folder are one gesture).
  // True while such a drag hovers the frame — drives the accent highlight.
  const [dropping, setDropping] = useState(false);

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

  // Store at most one geometry update per animation frame. `scheduledRef`
  // stays separate because test rAF stubs may invoke callbacks synchronously.
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
    pendingRef.current = null;
    const changed = drag.mode === "move" ? pending.a !== drag.origX || pending.b !== drag.origY
      : pending.a !== drag.origW || pending.b !== drag.origH;
    if (!changed) return;
    if (!drag.historyRecorded) {
      useApp.getState().recordHistory(drag.mode === "move" ? "move window" : "resize window");
      drag.historyRecorded = true;
    }
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

  const finishGesture = useCallback(() => {
    if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
    // A release can beat the queued frame, so commit its last position first.
    flush();
    dragRef.current = null;
    pendingRef.current = null;
    scheduledRef.current = false;
    rafIdRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    END_GESTURE_EVENTS.forEach((event) => window.removeEventListener(event, finishGesture));
  }, [flush, onPointerMove]);

  useEffect(
    () => () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      window.removeEventListener("pointermove", onPointerMove);
      END_GESTURE_EVENTS.forEach((event) => window.removeEventListener(event, finishGesture));
    },
    [onPointerMove, finishGesture],
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
      historyRecorded: false,
      // Capture other visible rectangles once so handlers stay stable.
      siblings: useApp
        .getState()
        .plotWindows.filter((w) => w.id !== win.id && w.winState !== "minimized")
        .map((w) => w.geometry),
    };
    window.addEventListener("pointermove", onPointerMove);
    END_GESTURE_EVENTS.forEach((event) => window.addEventListener(event, finishGesture));
  };

  // Capture-phase focus raises the frame before child/uPlot handlers run.
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
  // alone: PlotStage (or the title bar) manages its own contextmenu. Item-17
  // document windows (never focused) also take this path — harmless, since
  // preventDefault doesn't stop propagation: WorksheetPane's own column/row
  // context menus (which preventDefault themselves) still open normally.
  const onFrameContextMenu = (e: React.MouseEvent) => {
    if (!focused) e.preventDefault();
  };

  // GUI_INTERACTION #3 sub-item 2b: the SAME eligibility a real drop already
  // checks (kind !== snapshot/panel) — every OTHER eligible frame lights up
  // the moment a dataset drag starts, not only the one the pointer happens
  // to be over (`dropping`, above).
  const isDropCandidate =
    activeDrag?.kind === "dataset" && win.kind !== "snapshot" && win.kind !== "panel" && !dropping;

  return (
    <div
      className={`qzk-plotwin${focused ? " focused" : ""}${dropping ? " dropping" : ""}${isDropCandidate ? " drop-candidate" : ""}`}
      style={style}
      onPointerDownCapture={onFrameCapture}
      onContextMenuCapture={onFrameContextMenu}
      onDragOver={(e) => {
        // Neither a snapshot ("frozen means frozen") nor a panel window
        // (item 19 — its binding is `panel.datasetIds`, not this single-id
        // field) advertises a rebind it would silently ignore: no highlight,
        // no preventDefault, so the drop falls through to the canvas beneath
        // (which opens a NEW window for it instead).
        if (win.kind === "snapshot" || win.kind === "panel" || !e.dataTransfer.types.includes(DATASET_DND))
          return;
        e.preventDefault(); // required every dragover to keep the drop legal
        if (!dropping) setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (win.kind === "snapshot" || win.kind === "panel" || !e.dataTransfer.types.includes(DATASET_DND))
          return;
        e.preventDefault();
        e.stopPropagation(); // a frame drop must never ALSO create a canvas window
        setDropping(false);
        const droppedId = e.dataTransfer.getData(DATASET_DND);
        // The explicit gesture — rebinds even a pinned window (item 14).
        if (droppedId) rebindWindow(win.id, droppedId);
      }}
    >
      <div
        className="qzk-plotwin-titlebar"
        title="Drag to move · double-click to maximize · drop a dataset here to rebind"
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
        {win.kind === "snapshot" && (
          // Item 11: the "frozen" indicator — a snapshot window's data was
          // captured at freeze time and does not follow the source dataset.
          <span
            className="qzk-plotwin-frozen"
            title="Frozen snapshot — captured at freeze time; does not follow the source dataset"
          >
            <Badge tone="accent">⎘ frozen</Badge>
          </span>
        )}
        {win.kind === "worksheet" && (
          // Item 17: the document-kind indicator (glyphs, never emoji) — the
          // snapshot "⎘ frozen" badge's sibling for the live document kinds.
          <span
            className="qzk-plotwin-kind"
            title="Worksheet window — the bound dataset's live, editable sheet"
          >
            <Badge tone="accent">▦ sheet</Badge>
          </span>
        )}
        {win.kind === "map" && (
          <span className="qzk-plotwin-kind" title="Map window — 2-D map of the bound dataset">
            <Badge tone="accent">▩ map</Badge>
          </span>
        )}
        {win.kind === "panel" && (
          // Item 19 v1: the composite-window indicator, mirroring the
          // worksheet/map kind badges above — the layout name so a glance
          // says row/column/grid/overlay.
          <span
            className="qzk-plotwin-kind"
            title={`${win.panel?.layout ?? "grid"} panel — ${(win.panel?.datasetIds ?? []).length} dataset(s)`}
          >
            <Badge tone="accent">⊞ {win.panel?.layout ?? "grid"}</Badge>
          </span>
        )}
        {datasetName && <span className="qzk-plotwin-badge">{datasetName}</span>}
        {datasetMeta && (
          <Badge tone="accent" className="qzk-plotwin-meta">
            {datasetMeta.channels}ch · {datasetMeta.rows}pts
          </Badge>
        )}
        <WindowTitleButtons win={win} />
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
