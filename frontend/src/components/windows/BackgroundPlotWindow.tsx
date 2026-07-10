// The BACKGROUND (unfocused) plot window's content (MULTI_PLOT_PLAN item 4,
// Key Decision 2): live data through the SAME fetch/compose pipeline the
// focused window uses (usePlotPayload → PlotViewport), driven by the
// window's OWN `PlotView` snapshot rather than the live singleton store
// fields — and with NO interactive tool plugins (no toolbar/legend/readouts/
// context menu either — v1 keeps a background window a plain live preview).
// `PlotWindowFrame`'s capture-phase pointerdown handler focuses the window
// (which snapshot-swaps it to a `PlotStage` in the next render) before any
// drag gesture could reach this component, so it never needs its own
// pointerdown handling.
//
// Row exclusion/filter still apply (via the shared usePlotPayload → the #50/
// #53 `lib/rowstate` chokepoint), so N windows on the same dataset all
// reflect a live exclusion toggle together — the item-4 row-state proof.

import { useRef } from "react";
import type uPlot from "uplot";

import type { PlotBg, PlotView } from "../../lib/plotview";
import { resolveTemplate } from "../../lib/plotTemplates";
import type { Dataset } from "../../lib/types";
import { LINEAR_PATHS, POINTS_PATHS, STEPPED_PATHS } from "../../lib/uplotPaths";
import { useApp } from "../../store/useApp";
import PlotViewport from "../Stage/PlotViewport";
import { usePlotPayload } from "../Stage/usePlotPayload";

export interface BackgroundPlotWindowProps {
  /** The window's bound dataset (null = unbound, or its dataset was removed
   *  — MULTI_PLOT_PLAN decision #4's "empty state", never force-closed). */
  dataset: Dataset | null;
  view: PlotView;
  /** This window's background override (item 18) — undefined defaults to
   *  "theme" (today's always-dark canvas), matching a window record that
   *  predates the field (`sanitizePlotWindows` also defaults it the same
   *  way for a persisted `.dwk`). */
  bg?: PlotBg;
}

export default function BackgroundPlotWindow({ dataset, view, bg }: BackgroundPlotWindowProps) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const defaultTrace = useApp((s) => s.defaultTrace);
  const defaultLineWidth = useApp((s) => s.defaultLineWidth);
  const excludedDisplay = useApp((s) => s.excludedDisplay);
  const plotRef = useRef<uPlot | null>(null);

  const { displayPayload, styleList, labelList, errorBars, hidden } = usePlotPayload({
    active: dataset,
    yLog: view.yLog,
    xLog: view.xLog,
    xKey: view.xKey,
    yKeys: view.yKeys,
    y2Keys: view.y2Keys,
    seriesOrder: view.seriesOrder,
    seriesStyles: view.seriesStyles,
    seriesLabels: view.seriesLabels,
    errKeys: view.errKeys,
    hiddenChannels: view.hiddenChannels,
    waterfall: view.waterfall,
    excludedDisplay,
    // Tool overlays are focused-window-only (decision #2) — a background
    // window never shows a fit/baseline/peak/derivative curve.
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: null,
  });

  if (!dataset) {
    return (
      <div
        className="qzk-ds-meta"
        style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
      >
        No dataset — drag one onto this window, or focus it and pick from the Library
      </div>
    );
  }

  return (
    <PlotViewport
      plotRef={plotRef}
      displayPayload={displayPayload}
      theme={theme}
      accent={accent}
      yLog={view.yLog}
      xLog={view.xLog}
      xLim={view.xLim}
      yLim={view.yLim}
      xStep={view.xStep}
      yStep={view.yStep}
      y2Lim={view.y2Lim}
      y2Log={view.y2Log}
      y2Step={view.y2Step}
      xFmt={view.xFmt}
      yFmt={view.yFmt}
      showGrid={view.showGrid}
      axisBox={view.showAxisBox}
      fontSize={resolveTemplate(view.plotTemplate).fontSize}
      baseLineWidth={
        view.plotTemplate === "screen" ? defaultLineWidth : resolveTemplate(view.plotTemplate).lineWidth
      }
      defaultTrace={defaultTrace}
      steppedPaths={STEPPED_PATHS}
      linearPaths={LINEAR_PATHS}
      pointsPaths={POINTS_PATHS}
      // No wheel-zoom / on-plot tools until the window is focused (decision 2).
      wheelZoom={false}
      title={view.plotTitle}
      xAxisLabel={view.xAxisLabel}
      yAxisLabel={view.yAxisLabel}
      y2AxisLabel={view.y2AxisLabel}
      refLines={view.refLines}
      annotations={view.annotations}
      seriesStyles={styleList}
      seriesLabels={labelList}
      errorBars={errorBars}
      hidden={hidden}
      tool="zoom"
      onReadout={() => {}}
      peakWizardEdit={null}
      bg={bg}
    />
  );
}
