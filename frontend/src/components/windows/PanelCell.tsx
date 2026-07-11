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
//
// Drag-to-rearrange follow-up: the dataset name used to ride uPlot's own
// `.u-title` (INSIDE the canvas host, re-rendered by uPlot itself) — that
// can't be a drag handle without fighting uPlot's own mouse handling, so it's
// promoted to a real header row owned by THIS component (`title=""` below
// turns uPlot's built-in title off; PlotViewport reserves zero height for an
// empty title). The header is window furniture (like an MDI title bar), so
// dragging it rearranges cells in ANY plot tool — the canvas underneath
// keeps its normal box-zoom/pan/etc regardless of tool mode. Reorder is a
// reorder-INSERT (drop A on B splices A into B's slot), computed by the pure
// `lib/panelwindow.reorderPanelDatasetIds` and applied via the store's
// `reorderPanelDatasets` — this component only decides WHEN a drop landed
// and on which two indices.

import { useRef, useState } from "react";
import type uPlot from "uplot";

import {
  decodePanelCellDrag,
  encodePanelCellDrag,
  PANEL_CELL_DND,
} from "../../lib/panelwindow";
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
  /** The composite window this cell lives in (drag payload + store target). */
  windowId: string;
  /** This cell's position in `win.panel.datasetIds` — see PanelPlotWindow's
   *  header comment on why it's the RAW array index, not a render-order one. */
  index: number;
}

const CELL_VIEW = defaultPlotView();

function isPanelCellDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(PANEL_CELL_DND);
}

export default function PanelCell({ dataset, syncKey, windowId, index }: PanelCellProps) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const defaultTrace = useApp((s) => s.defaultTrace);
  const defaultLineWidth = useApp((s) => s.defaultLineWidth);
  const excludedDisplay = useApp((s) => s.excludedDisplay);
  const reorderPanelDatasets = useApp((s) => s.reorderPanelDatasets);
  const removeFromPanel = useApp((s) => s.removeFromPanel);
  const plotRef = useRef<uPlot | null>(null);
  // Local drag affordance state (same idiom as ZoneWell's `over` / DatasetRow's
  // `dropEdge`): `dragging` dims THIS cell while ITS header is the drag
  // source; `dragOver` highlights THIS cell while another cell's drag hovers
  // it as the drop target. Neither needs to be lifted to the parent — HTML5
  // DnD delivers dragstart/dragover/drop straight to the element under the
  // pointer.
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);

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
    <div
      className={`qzk-panel-cell${dragging ? " dragging" : ""}${dragOver ? " drop-target" : ""}`}
    >
      <div
        className="qzk-panel-cell-hd"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(PANEL_CELL_DND, encodePanelCellDrag({ windowId, fromIndex: index }));
          e.dataTransfer.effectAllowed = "move";
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
        onDragOver={(e) => {
          if (!isPanelCellDrag(e.dataTransfer)) return;
          e.preventDefault(); // required every dragover to keep the drop legal
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!isPanelCellDrag(e.dataTransfer)) return;
          e.preventDefault();
          setDragOver(false);
          const payload = decodePanelCellDrag(e.dataTransfer.getData(PANEL_CELL_DND));
          if (!payload || payload.windowId !== windowId || payload.fromIndex === index) return; // foreign window / self-drop no-op
          reorderPanelDatasets(windowId, payload.fromIndex, index);
        }}
      >
        <span className="qzk-panel-cell-title" title={dataset.name}>
          {dataset.name}
        </span>
        <button
          type="button"
          className="qzk-panel-cell-remove"
          title="Remove from panel"
          aria-label={`Remove ${dataset.name} from panel`}
          onClick={(e) => {
            e.stopPropagation();
            removeFromPanel(windowId, dataset.id);
          }}
        >
          {"×"}
        </button>
      </div>
      <div className="qzk-panel-cell-body">
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
          title=""
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
    </div>
  );
}
