// The Stage cell's plot-window host (MULTI_PLOT_PLAN item 3): renders every
// VISIBLE (non-minimized) `plotWindows[]` entry, each z-stacked among the
// others inside the frames host's own stacking context — below workshop
// `ToolWindow` overlays, which float above the whole app rather than just
// the stage cell (Key Decision 3). The single-maximized-window case (every
// fresh workspace's default per decision #6) renders `PlotStage` ALONE, with
// none of this file's chrome in the DOM — pixel-identical to the
// pre-MULTI_PLOT_PLAN Stage (the visual-harness migration guarantee). MDI
// chrome (title bar / resize grip / dataset badge) appears the moment there
// are ≥2 windows (of any winState), or the sole window is explicitly
// restored down.
//
// The focused window renders the full interactive `PlotStage` composition;
// every other VISIBLE window renders a live, non-interactive
// `BackgroundPlotWindow` (item 4, Key Decision 2). A MINIMIZED window (item
// 8) renders NEITHER — it's fully unmounted (no uPlot instance at all, per
// the plan's perf risk note) and instead gets one entry in the `qzk-winstrip`
// dock along the canvas bottom; clicking it restores + focuses the window.

import { useEffect, useRef, useState } from "react";

import { useApp } from "../../store/useApp";
import PlotStage from "../Stage/PlotStage";
import BackgroundPlotWindow from "./BackgroundPlotWindow";
import PlotWindowFrame from "./PlotWindowFrame";

export default function WindowCanvas() {
  const plotWindows = useApp((s) => s.plotWindows);
  const focusedWindowId = useApp((s) => s.focusedWindowId);
  const datasets = useApp((s) => s.datasets);
  const restoreWindow = useApp((s) => s.restoreWindow);
  const setPlotCanvasBounds = useApp((s) => s.setPlotCanvasBounds);

  const hostRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<{ width: number; height: number } | undefined>(undefined);

  // Track the frames host's own size (never the window's, and never
  // including the winstrip below it) so PlotWindowFrame can keep every title
  // bar reachable across a browser/panel resize (its `bounds` prop doc), and
  // so item 6's Tile/Cascade commands have a real pixel size to lay out
  // against (`plotCanvasBounds` — the store's sole writer is this effect).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) {
        setBounds({ width: box.width, height: box.height });
        setPlotCanvasBounds({ width: box.width, height: box.height });
      }
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      setPlotCanvasBounds(null);
    };
  }, [setPlotCanvasBounds]);

  // ORIGIN_FILE_DECODE_PLAN #38: every VISIBLE window's bound dataset gets
  // its full data fetched (if it's still a lazy Origin book) — covers the
  // background (non-focused) windows a plain click never activates. The
  // focused window's own fetch is triggered by PlotStage's identical effect;
  // ensureBookData is single-flight, so covering it again here is harmless.
  useEffect(() => {
    for (const win of plotWindows) {
      if (win.winState === "minimized" || !win.datasetId) continue;
      const ds = datasets.find((d) => d.id === win.datasetId);
      if (ds?.pending) useApp.getState().ensureBookData(ds.id);
    }
  }, [plotWindows, datasets]);

  // Decision #6 — the migration guarantee: a single maximized window is
  // PIXEL-IDENTICAL to the pre-MULTI_PLOT_PLAN Stage (no chrome at all, and
  // no extra host div — PlotStage keeps rendering directly into the
  // `.qzk-stage-cell` tab slot exactly as it did before this plan).
  if (plotWindows.length === 1 && plotWindows[0].winState === "maximized") {
    return <PlotStage />;
  }

  const visible = plotWindows.filter((w) => w.winState !== "minimized");
  const minimized = plotWindows.filter((w) => w.winState === "minimized");

  return (
    <div className="qzk-wincanvas">
      <div className="qzk-wincanvas-frames" ref={hostRef}>
        {visible.map((win) => {
          const focused = win.id === focusedWindowId;
          const dataset = win.datasetId ? (datasets.find((d) => d.id === win.datasetId) ?? null) : null;
          const datasetMeta = dataset
            ? { channels: dataset.data.labels.length, rows: dataset.data.time.length }
            : undefined;
          return (
            <PlotWindowFrame
              key={win.id}
              win={win}
              focused={focused}
              datasetName={dataset?.name}
              datasetMeta={datasetMeta}
              bounds={bounds}
            >
              {focused ? (
                <PlotStage />
              ) : (
                <BackgroundPlotWindow
                  dataset={dataset}
                  view={win.view}
                  bg={win.bg}
                  linkGroup={win.linkGroup}
                />
              )}
            </PlotWindowFrame>
          );
        })}
      </div>
      {minimized.length > 0 && (
        <div className="qzk-winstrip">
          {minimized.map((win) => {
            const dataset = win.datasetId ? (datasets.find((d) => d.id === win.datasetId) ?? null) : null;
            const title = win.title || dataset?.name || "Untitled graph";
            return (
              <button
                key={win.id}
                type="button"
                className="qzk-winstrip-item"
                title={`Restore "${title}"`}
                onClick={() => restoreWindow(win.id)}
              >
                {title}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
