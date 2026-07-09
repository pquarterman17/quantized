// The Stage cell's plot-window host (MULTI_PLOT_PLAN item 3): renders every
// `plotWindows[]` entry, each z-stacked among the others inside THIS
// element's own stacking context — below workshop `ToolWindow` overlays,
// which float above the whole app rather than just the stage cell (Key
// Decision 3). The single-maximized-window case (today's only state, and
// every fresh workspace's default per decision #6) renders `PlotStage`
// ALONE, with none of this file's chrome in the DOM — pixel-identical to
// the pre-MULTI_PLOT_PLAN Stage (the visual-harness migration guarantee).
// MDI chrome (title bar / resize grip / dataset badge) appears the moment
// there are ≥2 windows, or the sole window is explicitly restored down.
//
// Every window renders the full `PlotStage` composition for now (item 4
// splits this into a focused/background dispatch, so only one window is
// ever fully interactive at a time).

import { useEffect, useRef, useState } from "react";

import { useApp } from "../../store/useApp";
import PlotStage from "../Stage/PlotStage";
import PlotWindowFrame from "./PlotWindowFrame";

export default function WindowCanvas() {
  const plotWindows = useApp((s) => s.plotWindows);
  const focusedWindowId = useApp((s) => s.focusedWindowId);
  const datasets = useApp((s) => s.datasets);

  const hostRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<{ width: number; height: number } | undefined>(undefined);

  // Track the canvas's own size (never the window's) so PlotWindowFrame can
  // keep every title bar reachable across a browser/panel resize — see its
  // `bounds` prop doc.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box) setBounds({ width: box.width, height: box.height });
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Decision #6 — the migration guarantee: a single maximized window is
  // PIXEL-IDENTICAL to the pre-MULTI_PLOT_PLAN Stage (no chrome at all, and
  // no extra host div — PlotStage keeps rendering directly into the
  // `.qzk-stage-cell` tab slot exactly as it did before this plan).
  if (plotWindows.length === 1 && plotWindows[0].winState === "maximized") {
    return <PlotStage />;
  }

  return (
    <div className="qzk-wincanvas" ref={hostRef}>
      {plotWindows.map((win) => {
        const dataset = win.datasetId ? datasets.find((d) => d.id === win.datasetId) : undefined;
        return (
          <PlotWindowFrame
            key={win.id}
            win={win}
            focused={win.id === focusedWindowId}
            datasetName={dataset?.name}
            bounds={bounds}
          >
            <PlotStage />
          </PlotWindowFrame>
        );
      })}
    </div>
  );
}
