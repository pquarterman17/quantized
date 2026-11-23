// The floating windows of the layout (WORKSPACE_LAYOUT_PLAN P1), above every
// docked one. They reuse the existing move/resize machinery rather than a new
// one: a plot window is the classic `PlotWindowFrame` at its own
// `PlotWindow.geometry` (drag, resize, sibling snapping, title-bar buttons),
// with the dock buttons added to its title bar; Style, Data and Analysis are each a
// `ToolWindow` at their own `toolWindowLayout` rect (`style`, `data`, `analysis`),
// and an analysis tool is its classic frame at the rect classic mode uses for it,
// portalled to the app root where every other tool window lives, so their
// viewport coordinates mean the same thing.
//
// Stacking: plot frames stack by `PlotWindow.z` (focusing one raises it, as in
// classic), so the z a classic reader sees in a saved file is the live one;
// tool windows sit in their own band above, as they always have.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { Dataset } from "../../../lib/types";
import type { PlotWindow } from "../../../lib/plotview";
import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import { useApp } from "../../../store/useApp";
import { EDGE_GAP, PLOT_BAR_CLEAR, TOOL_W } from "../../../lib/windowLayout/visibility";
import { floatKeyOf, plotIdOf } from "../../../store/windowLayoutActions";
import { closeFromChrome } from "./chromeActions";
import { lazyRegion } from "../../../lib/lazyRegion";
import PlotWindowFrame from "../../windows/PlotWindowFrame";
import { AnalysisTitle } from "./AnalysisTitle";
import { DataTitle } from "./DataWindow";
import DockButtons from "./DockButtons";
import { dragFromPointerDown } from "./layoutDrag";
import FloatingTool from "./FloatingTool";
import { useClearOfTools } from "./useClearOfTools";
import { datasetOf, PlotWindowBody } from "./LayoutWindowContent";
import LayoutWindowContent from "./LayoutWindowContent";

// The tool-window frame is already a chunk of its own (every workshop uses it);
// loading it on demand keeps its preload list out of the entry chunk.
/** Style floats against the desk's right edge (not over the plot, where "Float all" would cover the
 *  first plot window); Data opens beside it, never on top of it. */
const styleX = () => Math.max(120, (typeof window === "undefined" ? 1280 : window.innerWidth) - TOOL_W - EDGE_GAP);
const dataX = () => Math.max(120, Math.min(500, styleX() - TOOL_W - 8));
/** Analysis opens beside Data, one window further left. */
const analysisX = () => Math.max(120, dataX() - TOOL_W - 8);
const SINGLETON_X: Record<string, () => number> = { style: styleX, data: dataX, analysis: analysisX };

const ToolWindow = lazyRegion(() => import("../../overlays/ToolWindow"), "Window");

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
  // The desk's top edge in viewport px: a floating Style/Data window opens below the toolbar, never over it.
  const layerRef = useRef<HTMLDivElement>(null);
  const [deskTop, setDeskTop] = useState<number | null>(null);
  useLayoutEffect(() => setDeskTop(Math.round(layerRef.current?.getBoundingClientRect().top ?? 0)), []);
  useClearOfTools(
    layerRef,
    floating.map(plotIdOf).filter((id): id is string => id !== null),
  );
  const toolRects = useApp((s) => s.toolWindowLayout);
  const setToolWindowLayout = useApp((s) => s.setToolWindowLayout);
  const floatingTools = floating
    .filter((r) => plotIdOf(r) === null)
    .map(floatKeyOf)
    .join(",");
  // A saved rect from classic (or an older desk) may sit above the desk top: bring it down once.
  useEffect(() => {
    if (deskTop === null) return;
    for (const key of floatingTools ? floatingTools.split(",") : []) {
      const rect = toolRects[key];
      if (rect && rect.y < deskTop) setToolWindowLayout(key, { ...rect, y: deskTop });
    }
  }, [deskTop, toolRects, floatingTools, setToolWindowLayout]);
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
    <div className="qzk-wl-float" data-testid="wl-float" ref={layerRef}>
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
        if (!root || deskTop === null) return null;
        const title = titleOf(ref);
        if (ref.startsWith("tool:")) {
          return (
            <div key={`${ref}:${epoch}`} className="qzk-wl-contents" onPointerDownCapture={watch(ref)}>
              {createPortal(<FloatingTool refId={ref} title={title} deskTop={deskTop} />, root)}
            </div>
          );
        }
        if (!SINGLETON_X[ref]) return null;
        return (
          <div key={ref} className="qzk-wl-contents" onPointerDownCapture={watch(ref)}>
            {createPortal(
              <ToolWindow
                classic
                id={ref}
                title={title}
                keepOnEscape // docked ones never close on Escape either (UX pass 3 M5, provisional)
                // Never floated before: against the right edge, below a plot title bar, Data beside Style.
                x={SINGLETON_X[ref]()}
                y={deskTop + PLOT_BAR_CLEAR}
                titleExtra={
                  <>
                    {ref === "data" && <DataTitle />}
                    {ref === "analysis" && <AnalysisTitle />}
                    <DockButtons refId={ref} slot={null} title={title} />
                    <button
                      type="button"
                      className="qzk-wl-close"
                      aria-label={`Close ${title}`}
                      title="Close this window."
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => closeFromChrome(ref)}
                    >
                      ✕
                    </button>
                  </>
                }
              >
                <div className={ref === "data" ? "qzk-wl-data-float" : ref === "analysis" ? "qzk-wl-analysis-float" : "qzk-wl-style-float"}>
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
