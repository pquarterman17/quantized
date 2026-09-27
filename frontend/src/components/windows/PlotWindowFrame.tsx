// The MDI chrome around one plot window's content (MULTI_PLOT_PLAN item 3):
// a draggable title bar (window title + dataset badge), a resize grip, a
// close button, and a focus highlight using `--accent`. Geometry/z mutations
// flow through the existing store actions (moveWindow/resizeWindow/
// raiseWindow/focusWindow — Key Decision 3). Live gestures preview directly
// on this frame once per animation frame and commit to the store only on
// release, keeping sibling plots out of React's hot path.
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

import { type ReactNode, useEffect, useState } from "react";

import { type PlotWindow } from "../../lib/plotview";
import { resolvePlotBg } from "../../lib/uplotOpts";
import { useApp } from "../../store/useApp";
import { useWindowsStore } from "../../store/hooks/useWindowsStore";
import { DATASET_DND } from "../Library/dnd";
import { Badge } from "../primitives";
import WindowTitleButtons from "./WindowTitleButtons";
import { clampPlotWindowPosition, type ResizeEdge, usePlotWindowGesture } from "./usePlotWindowGesture";

const RESIZE_EDGES: ResizeEdge[] = ["n", "e", "s", "w", "ne", "nw", "se", "sw"];

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

export default function PlotWindowFrame({
  win,
  focused,
  datasetName,
  datasetMeta,
  bounds,
  children,
}: PlotWindowFrameProps) {
  const moveWindow = useWindowsStore((s) => s.moveWindow);
  const focusWindow = useWindowsStore((s) => s.focusWindow);
  const toggleMaximizeWindow = useWindowsStore((s) => s.toggleMaximizeWindow);
  const renameWindow = useWindowsStore((s) => s.renameWindow);
  const rebindWindow = useWindowsStore((s) => s.rebindWindow);
  const activeDrag = useApp((s) => s.activeDrag);
  const { frameRef, beginDrag } = usePlotWindowGesture(win, bounds);

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
    if (!bounds || win.winState === "maximized" || frameRef.current?.hasAttribute("data-gesturing")) return;
    const clamped = clampPlotWindowPosition(win.geometry.x, win.geometry.y, bounds);
    if (clamped.x !== win.geometry.x || clamped.y !== win.geometry.y) {
      moveWindow(win.id, clamped.x, clamped.y);
    }
    // Only re-run when the CANVAS resizes or this window's identity changes —
    // not on every geometry tick (that would fight live dragging).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds?.width, bounds?.height, win.id, win.winState]);

  // Capture-phase focus raises the frame before child/uPlot handlers run.
  const onFrameCapture = () => {
    if (!focused) focusWindow(win.id);
  };

  const maximized = win.winState === "maximized";
  const style: React.CSSProperties = maximized
    ? { position: "absolute", inset: 0, padding: 0 }
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
      ref={frameRef}
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
        RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            className={`qzk-plotwin-resize qzk-plotwin-resize-${edge}`}
            data-resize-edge={edge}
            aria-hidden="true"
            onPointerDown={beginDrag(edge)}
          />
        ))
      )}
    </div>
  );
}
