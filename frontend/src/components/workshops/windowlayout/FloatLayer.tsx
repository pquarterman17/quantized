// The floating windows of the layout (WORKSPACE_LAYOUT_PLAN P1), above every
// docked one. They reuse the existing move/resize machinery rather than a new
// one: a plot window is the classic `PlotWindowFrame` at its own
// `PlotWindow.geometry` (drag, resize, sibling snapping, title-bar buttons),
// with the dock buttons added to its title bar; Style is a `ToolWindow` at its
// `toolWindowLayout.style` rect, portalled to the app root where every other
// tool window lives, so its viewport coordinates mean the same thing.
//
// Stacking: plot frames stack by `PlotWindow.z` (focusing one raises it, as in
// classic), so the z a classic reader sees in a saved file is the live one;
// tool windows sit in their own band above, as they always have.

import { useState } from "react";
import { createPortal } from "react-dom";

import type { Dataset } from "../../../lib/types";
import type { PlotWindow } from "../../../lib/plotview";
import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import { useApp } from "../../../store/useApp";
import { closeRef, plotIdOf } from "../../../store/windowLayoutActions";
import { lazyRegion } from "../../../lib/lazyRegion";
import PlotWindowFrame from "../../windows/PlotWindowFrame";
import DockButtons from "./DockButtons";
import { dragFromPointerDown } from "./layoutDrag";
import { datasetOf, PlotWindowBody } from "./LayoutWindowContent";
import LayoutWindowContent from "./LayoutWindowContent";

// The tool-window frame is already a chunk of its own (every workshop uses it);
// loading it on demand keeps its preload list out of the entry chunk.
const ToolWindow = lazyRegion(() => import("../../overlays/ToolWindow"), "Style");

function FloatingPlot({
  win,
  datasets,
  bounds,
  title,
}: {
  win: PlotWindow;
  datasets: readonly Dataset[];
  bounds?: { width: number; height: number };
  title: string;
}) {
  const focused = useApp((s) => s.focusedWindowId === win.id);
  const dataset = datasetOf(win, datasets);
  const frozen = win.document?.data.mode === "frozen" ? win.document.data.snapshot : undefined;
  const data = frozen ?? dataset?.data;
  return (
    <PlotWindowFrame
      win={win}
      focused={focused}
      datasetName={dataset?.name}
      datasetMeta={data ? { channels: data.labels.length, rows: data.time.length } : undefined}
      bounds={bounds}
      titleExtra={<DockButtons refId={`plot:${win.id}`} slot={null} title={title} />}
    >
      <PlotWindowBody win={win} />
    </PlotWindowFrame>
  );
}

export default function FloatLayer({
  layout,
  bounds,
  titleOf,
}: {
  layout: WindowLayoutV1;
  bounds?: { width: number; height: number };
  titleOf: (ref: WindowRef) => string;
}) {
  const plotWindows = useApp((s) => s.plotWindows);
  const datasets = useApp((s) => s.datasets);
  const floating = layout.z.filter((r) => layout.placements[r]?.open && layout.placements[r]?.slot === null);
  const root = typeof document === "undefined" ? null : (document.querySelector(".qzk-app") ?? document.body);
  // Dragging a floating title bar to a drop zone (layoutDrag.ts) rides on the
  // frame's own move. Escape puts the frame back by remounting it: the move
  // gesture's unmount restores the geometry it was previewing without committing.
  const [epoch, setEpoch] = useState(0);
  const watch = (ref: WindowRef) => (e: React.PointerEvent) => {
    const id = plotIdOf(ref);
    if (id !== null && plotWindows.find((w) => w.id === id)?.winState === "maximized") return;
    dragFromPointerDown(e, { ref, title: titleOf(ref), docked: false, onCancel: () => setEpoch((n) => n + 1) });
  };

  return (
    <div className="qzk-wl-float" data-testid="wl-float">
      {floating.map((ref) => {
        const id = plotIdOf(ref);
        if (id !== null) {
          const win = plotWindows.find((w) => w.id === id);
          if (!win || win.winState === "minimized") return null;
          return (
            <div key={`${ref}:${epoch}`} className="qzk-wl-contents" onPointerDownCapture={watch(ref)}>
              <FloatingPlot win={win} datasets={datasets} bounds={bounds} title={titleOf(ref)} />
            </div>
          );
        }
        if (ref !== "style" || !root) return null;
        const title = titleOf(ref);
        return (
          <div key={ref} className="qzk-wl-contents" onPointerDownCapture={watch(ref)}>
            {createPortal(
              <ToolWindow
                id="style"
                title={title}
                titleExtra={
                  <>
                    <DockButtons refId={ref} slot={null} title={title} />
                    <button
                      type="button"
                      className="qzk-wl-close"
                      aria-label={`Close ${title}`}
                      title="Close this window."
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => closeRef(ref)}
                    >
                      ✕
                    </button>
                  </>
                }
              >
                <div className="qzk-wl-style-float">
                  <LayoutWindowContent refId={ref} />
                </div>
              </ToolWindow>,
              root,
            )}
          </div>
        );
      })}
    </div>
  );
}
