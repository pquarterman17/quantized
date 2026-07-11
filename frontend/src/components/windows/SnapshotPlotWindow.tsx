// A SNAPSHOT window's content (MULTI_PLOT_PLAN item 11): the same render core
// the live windows use (PlotViewport), fed from the window's FROZEN display
// bundle instead of the fetch/compose pipeline — no fetch, no rowstate, no
// dataset binding, no tool plugins. Frozen means frozen: toggling row
// exclusion (or anything else) on the source dataset never changes what this
// window draws, because nothing here reads a dataset at all — the bundle was
// deep-copied at freeze time (lib/plotsnapshot's freezePlotSnapshot).
//
// The window's `view` is the source's live view frozen at the same moment, so
// axes/labels/scales/styling render as they did on screen. Theme/accent and
// the global Preferences plot defaults (defaultTrace/defaultLineWidth) stay
// live — they're app-wide display settings, deliberately excluded from
// PlotView (see lib/plotview's module doc), not part of the frozen data.

import { useMemo, useRef } from "react";
import type uPlot from "uplot";

import {
  thawColorByColumns,
  thawErrorBars,
  thawLabelList,
  thawStyleList,
  type FrozenPlotBundle,
} from "../../lib/plotsnapshot";
import { resolveTemplate } from "../../lib/plotTemplates";
import type { PlotBg, PlotView } from "../../lib/plotview";
import { LINEAR_PATHS, POINTS_PATHS, STEPPED_PATHS } from "../../lib/uplotPaths";
import { useApp } from "../../store/useApp";
import PlotViewport from "../Stage/PlotViewport";

export interface SnapshotPlotWindowProps {
  /** The frozen display bundle captured at freeze time (`PlotWindow.snapshot`). */
  frozen: FrozenPlotBundle;
  /** The source window's view, frozen at the same moment (`PlotWindow.view`). */
  view: PlotView;
  /** This window's background override (item 18) — same contract as
   *  `BackgroundPlotWindow`'s `bg` prop. */
  bg?: PlotBg;
}

export default function SnapshotPlotWindow({ frozen, view, bg }: SnapshotPlotWindowProps) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const defaultTrace = useApp((s) => s.defaultTrace);
  const defaultLineWidth = useApp((s) => s.defaultLineWidth);
  const plotRef = useRef<uPlot | null>(null);

  // Thaw the JSON-safe at-rest shapes back into PlotViewport's render shapes
  // once per bundle (a frozen bundle's identity never changes, so these are
  // stable for the window's whole life — no uPlot rebuild churn).
  const errorBars = useMemo(() => thawErrorBars(frozen.errorBars), [frozen]);
  const styleList = useMemo(() => thawStyleList(frozen.styleList), [frozen]);
  const labelList = useMemo(() => thawLabelList(frozen.labelList), [frozen]);
  const colorByColumns = useMemo(() => thawColorByColumns(frozen.colorByColumns), [frozen]);
  const hidden = useMemo(() => frozen.hidden ?? undefined, [frozen]);

  return (
    <PlotViewport
      plotRef={plotRef}
      displayPayload={frozen.payload}
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
      // A static compare window: no wheel-zoom, no on-plot tools (decision #2
      // applies a fortiori — a snapshot window is never even focusable).
      wheelZoom={false}
      title={view.plotTitle}
      xAxisLabel={view.xAxisLabel}
      yAxisLabel={view.yAxisLabel}
      y2AxisLabel={view.y2AxisLabel}
      refLines={view.refLines}
      annotations={view.annotations}
      regionShades={view.regionShades}
      seriesStyles={styleList}
      plotted={frozen.plotted}
      seriesLabels={labelList}
      errorBars={errorBars}
      colorByColumns={colorByColumns}
      hidden={hidden}
      tool="zoom"
      onReadout={() => {}}
      peakWizardEdit={null}
      anchorEdit={null}
      bg={bg}
    />
  );
}
