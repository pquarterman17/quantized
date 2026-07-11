// One dataset's viewport inside a multi-panel composite window (MAIN_PLAN
// #19 v1, row/column/grid layouts): the SAME usePlotPayload -> PlotViewport
// pipeline every single-dataset window uses (see BackgroundPlotWindow's
// BackgroundXYWindow), so row exclusion/filter (#50/#53) and every per-
// channel style/label/error mapping already apply with no extra plumbing.
// Always the plain default-channels XY view — a panel cell has no per-panel
// config UI in v1 (log axes, overlays, custom channel picks, …), matching
// the quick pick's "sensible default" framing. `syncKey` (when given) joins
// this viewport to the composite window's PRIVATE cross-panel sync group
// (`lib/panelwindow.panelSyncKey`) so x-zoom/cursor link across sibling
// panels — the row/column/grid layouts pass it; a lone/overlay viewport
// doesn't need one.

import { useRef } from "react";
import type uPlot from "uplot";

import { defaultPlotView } from "../../lib/plotview";
import { resolveTemplate } from "../../lib/plotTemplates";
import type { Dataset } from "../../lib/types";
import { LINEAR_PATHS, POINTS_PATHS, STEPPED_PATHS } from "../../lib/uplotPaths";
import { useApp } from "../../store/useApp";
import PlotViewport from "../Stage/PlotViewport";
import { usePlotPayload } from "../Stage/usePlotPayload";

export interface PanelCellProps {
  dataset: Dataset;
  syncKey?: string;
}

const CELL_VIEW = defaultPlotView();

export default function PanelCell({ dataset, syncKey }: PanelCellProps) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const defaultTrace = useApp((s) => s.defaultTrace);
  const defaultLineWidth = useApp((s) => s.defaultLineWidth);
  const excludedDisplay = useApp((s) => s.excludedDisplay);
  const plotRef = useRef<uPlot | null>(null);

  const { displayPayload, plotted, styleList, labelList, errorBars, colorByColumns, hidden } = usePlotPayload({
    active: dataset,
    yScale: CELL_VIEW.yScale,
    xScale: CELL_VIEW.xScale,
    xKey: CELL_VIEW.xKey,
    yKeys: CELL_VIEW.yKeys,
    y2Keys: CELL_VIEW.y2Keys,
    seriesOrder: CELL_VIEW.seriesOrder,
    seriesStyles: CELL_VIEW.seriesStyles,
    seriesLabels: CELL_VIEW.seriesLabels,
    errKeys: CELL_VIEW.errKeys,
    hiddenChannels: CELL_VIEW.hiddenChannels,
    waterfall: CELL_VIEW.waterfall,
    excludedDisplay,
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: null,
  });

  return (
    <div className="qzk-panel-cell">
      <PlotViewport
        plotRef={plotRef}
        displayPayload={displayPayload}
        theme={theme}
        accent={accent}
        yScale={CELL_VIEW.yScale}
        xScale={CELL_VIEW.xScale}
        xLim={null}
        yLim={null}
        xStep={null}
        yStep={null}
        y2Lim={null}
        y2Scale={null}
        y2Step={null}
        xFmt={CELL_VIEW.xFmt}
        yFmt={CELL_VIEW.yFmt}
        showGrid={CELL_VIEW.showGrid}
        axisBox={CELL_VIEW.showAxisBox}
        fontSize={resolveTemplate(CELL_VIEW.plotTemplate).fontSize}
        baseLineWidth={defaultLineWidth}
        defaultTrace={defaultTrace}
        steppedPaths={STEPPED_PATHS}
        linearPaths={LINEAR_PATHS}
        pointsPaths={POINTS_PATHS}
        wheelZoom={false}
        title={dataset.name}
        xAxisLabel={CELL_VIEW.xAxisLabel}
        yAxisLabel={CELL_VIEW.yAxisLabel}
        y2AxisLabel={CELL_VIEW.y2AxisLabel}
        refLines={[]}
        annotations={[]}
        regionShades={[]}
        seriesStyles={styleList}
        plotted={plotted}
        seriesLabels={labelList}
        errorBars={errorBars}
        colorByColumns={colorByColumns}
        hidden={hidden}
        tool="zoom"
        onReadout={() => {}}
        peakWizardEdit={null}
        anchorEdit={null}
        syncKey={syncKey}
      />
    </div>
  );
}
