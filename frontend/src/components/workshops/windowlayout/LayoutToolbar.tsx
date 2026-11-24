// The window-layout toolbar (WORKSPACE_LAYOUT_PLAN D4, the mockup's "Window"
// row): the arrange commands, then a toggle per singleton window (Style and
// Data; pressed = open, press to close or reopen it), a restore button per
// minimized plot window, and the way back to the classic layout. It takes the
// place of the classic stage tab strip, which windows mode hides.
//
// The row has a fixed height and never wraps its message away: a notice or the
// keyboard move-mode banner TAKES OVER the row while it lasts, so nothing
// pushes the desk down (a layout shift also re-clamps every window) and nothing
// is drawn over a window.
//
// A stage-tab request (classic actions still make them) is routed to its
// window by ./stageTabAdapter: Map to a map window, Workflow to the Analysis
// window. A view the layout cannot show yet (the Worksheet view, an Origin
// migration review) TAKES OVER the row with a notice that offers the classic
// layout, instead of the request silently doing nothing.

import { useEffect, useRef, useState } from "react";

import type { WindowLayoutV1 } from "../../../lib/windowLayout/types";
import { useApp } from "../../../store/useApp";
import { dockAllWindows, floatAllWindows, plotBesideDataWindows, reopenRef, tileAllWindows } from "../../../store/windowLayoutActions";
import { closeFromChrome, takeFocusAfterClose } from "./chromeActions";
import { announce } from "./layoutAnnounce";
import MoveBanner from "./MoveBanner";
import { useStageTabAdapter } from "./stageTabAdapter";
import { PLOT_DATA_HINT, PLOT_DATA_NO_PLOT } from "./useLayoutCommands";
import type { MoveState } from "./useMoveMode";

export default function LayoutToolbar({ layout, moving }: { layout: WindowLayoutV1; moving: MoveState | null }) {
  const plotWindows = useApp((s) => s.plotWindows);
  const minimized = plotWindows.filter((w) => w.winState === "minimized");
  const datasets = useApp((s) => s.datasets);
  const styleOpen = layout.placements.style?.open === true;
  const dataOpen = layout.placements.data?.open === true;
  const analysisOpen = layout.placements.analysis?.open === true;
  const hasPlot = useApp((s) => s.focusedWindowId !== null && layout.placements[`plot:${s.focusedWindowId}`] !== undefined);
  const setLayoutMode = useApp((s) => s.setLayoutMode);
  const setStatus = useApp((s) => s.setStatus);
  const bar = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refocus, setRefocus] = useState(0);

  // Take the stage-tab requests (see the header); a view not in the layout yet shows the notice.
  useStageTabAdapter(setNotice);

  // After Close on Style or Data, focus its toggle here (it would otherwise fall to <body>).
  useEffect(() => {
    const ref = takeFocusAfterClose((r) => layout.placements[r]?.open === true);
    if (ref) bar.current?.querySelector<HTMLElement>(`[data-wl-toggle="${ref}"]`)?.focus();
  }, [layout]);

  // After the notice goes, the toolbar is back: start at its first button.
  useEffect(() => {
    if (refocus) bar.current?.querySelector<HTMLElement>("button")?.focus();
  }, [refocus]);

  const plotData = () => {
    if (hasPlot) return plotBesideDataWindows();
    // aria-disabled keeps the button focusable; a click still has to answer.
    setStatus(PLOT_DATA_NO_PLOT, "warn");
    announce(PLOT_DATA_NO_PLOT);
  };

  return (
    <div className="qzk-wl-toolbar" role="toolbar" aria-label="Window layout" ref={bar}>
      {moving ? (
        <MoveBanner mode={moving} />
      ) : notice ? (
        <span className="qzk-wl-notice" role="status">
          The {notice} view is not in the window layout yet.
          <button type="button" className="qzk-wl-tbtn" onClick={() => void setLayoutMode("classic")}>
            Open the classic layout
          </button>
          <button
            type="button"
            className="qzk-wl-close"
            aria-label="Dismiss"
            title="Stay in the window layout."
            onClick={() => {
              setNotice(null);
              setRefocus((n) => n + 1);
            }}
          >
            ✕
          </button>
        </span>
      ) : (
        <>
          <span className="qzk-wl-toolbar-label">Window</span>
          <button type="button" className="qzk-wl-tbtn" aria-disabled={hasPlot ? undefined : true} title={hasPlot ? PLOT_DATA_HINT : PLOT_DATA_NO_PLOT} onClick={plotData}>
            ▥ Plot | Data side by side
          </button>
          <button type="button" className="qzk-wl-tbtn" title="Share the center between every open window as an even grid." onClick={tileAllWindows}>
            ⊞ Tile all
          </button>
          <button type="button" className="qzk-wl-tbtn" title="Dock the focused plot in the center, Data, Style and Analysis on the right, and open tools at the bottom." onClick={dockAllWindows}>
            ▦ Dock all
          </button>
          <button type="button" className="qzk-wl-tbtn" title="Float every docked window at its own saved position." onClick={floatAllWindows}>
            ⧉ Float all
          </button>
          <span className="qzk-wl-toolbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="qzk-wl-pill"
            data-wl-toggle="style"
            aria-pressed={styleOpen}
            title={styleOpen ? "Close the Style window." : "Reopen the Style window where it was."}
            onClick={() => (styleOpen ? closeFromChrome("style") : reopenRef("style"))}
          >
            Style
          </button>
          <button
            type="button"
            className="qzk-wl-pill"
            data-wl-toggle="data"
            aria-pressed={dataOpen}
            title={dataOpen ? "Close the Data window." : "Reopen the Data window where it was."}
            onClick={() => (dataOpen ? closeFromChrome("data") : reopenRef("data"))}
          >
            Data
          </button>
          <button
            type="button"
            className="qzk-wl-pill"
            data-wl-toggle="analysis"
            aria-pressed={analysisOpen}
            title={analysisOpen ? "Close the Analysis window." : "Reopen the Analysis window: the guide and every analysis tool for the focused plot."}
            onClick={() => (analysisOpen ? closeFromChrome("analysis") : reopenRef("analysis"))}
          >
            Analysis
          </button>
          {minimized.map((w) => {
            const name = w.title || datasets.find((d) => d.id === w.datasetId)?.name || "Untitled graph";
            return (
              <button key={w.id} type="button" className="qzk-wl-pill" title={`Restore "${name}".`} onClick={() => reopenRef(`plot:${w.id}`)}>
                ▭ {name}
              </button>
            );
          })}
          <button type="button" className="qzk-wl-tbtn qzk-wl-classic" title="Switch back to the classic layout; this window layout is kept for next time." onClick={() => void setLayoutMode("classic")}>
            ↩ Classic layout
          </button>
        </>
      )}
    </div>
  );
}
