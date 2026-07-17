// The hero canvas: the focused-window composition over the render core
// (PlotViewport) — reads the ~40 singleton plot-view fields from the store,
// runs the fetch/compose pipeline (usePlotPayload), and renders the toolbar /
// legend / readouts / context menu chrome around the uPlot instance.
// Re-styles on theme/accent change; resizes to its container.
// (MULTI_PLOT_PLAN item 1 / PROJECT_ORGANIZATION_PLAN #10: the uPlot lifecycle
// and the fetch+compose pipeline now live in PlotViewport.tsx / usePlotPayload.ts
// — this file is the thin store-reading wrapper around them.)

import { useEffect, useRef, useState } from "react";
import type uPlot from "uplot";

import { clampPlottedRange, rowsInXRange } from "../../lib/plotdata";
import type { Measurement } from "../../lib/measure";
import type { RegionStats } from "../../lib/regionStats";
import { resolveTemplate } from "../../lib/plotTemplates";
import { resolvePlotBg } from "../../lib/uplotOpts";
import { LINEAR_PATHS, POINTS_PATHS, STEPPED_PATHS } from "../../lib/uplotPaths";
import { windowSyncKey } from "../../lib/windowsync";
import type { Readout } from "../../lib/uplotTools";
import { useActiveDataset, useApp } from "../../store/useApp";
import { snapshotToNewWindow } from "../windows/useWindowCommands";
import AxisDropZones from "./AxisDropZones";
import InsetPlot from "./InsetPlot";
import MultiPanelStage from "./MultiPanelStage";
import PlotLegend from "./PlotLegend";
import PlotReadouts from "./PlotReadouts";
import PlotResultChips from "./PlotResultChips";
import PlotStageMenus from "./PlotStageMenus";
import PlotToolbar from "./PlotToolbar";
import PlotViewport from "./PlotViewport";
import PolarStage from "./PolarStage";
import StatStage from "./StatStage";
import ToolHud from "./ToolHud";
import { useAnnotationEdit } from "./useAnnotationEdit";
import { useAxisLabelEdit } from "./useAxisLabelEdit";
import { useAxisDrop } from "./useAxisDrop";
import { useGadgetChip } from "./useGadgetChip";
import { useLiveSnapshotPublish } from "./useLiveSnapshotPublish";
import { usePlotPayload } from "./usePlotPayload";
import { usePlotStageActions } from "./usePlotStageActions";
import { useShapeDraw } from "./useShapeDraw";
import { useShapeEdit } from "./useShapeEdit";
import { useStageContextMenu } from "./useStageContextMenu";

export default function PlotStage() {
  const active = useActiveDataset();
  const yScale = useApp((s) => s.yScale);
  const xScale = useApp((s) => s.xScale);
  const xLim = useApp((s) => s.xLim);
  const yLim = useApp((s) => s.yLim);
  const xStep = useApp((s) => s.xStep);
  const yStep = useApp((s) => s.yStep);
  const xFmt = useApp((s) => s.xFmt);
  const yFmt = useApp((s) => s.yFmt);
  const plotTitle = useApp((s) => s.plotTitle);
  const xAxisLabel = useApp((s) => s.xAxisLabel);
  const yAxisLabel = useApp((s) => s.yAxisLabel);
  const y2AxisLabel = useApp((s) => s.y2AxisLabel);
  const showGrid = useApp((s) => s.showGrid);
  const showLegend = useApp((s) => s.showLegend);
  const plotTemplate = useApp((s) => s.plotTemplate);
  const showAxisBox = useApp((s) => s.showAxisBox);
  // Plot defaults from Preferences (apply when no per-series override / template).
  const defaultTrace = useApp((s) => s.defaultTrace);
  const defaultLineWidth = useApp((s) => s.defaultLineWidth);
  const wheelZoom = useApp((s) => s.wheelZoom);
  const refLines = useApp((s) => s.refLines);
  const updateRefLine = useApp((s) => s.updateRefLine);
  const annotations = useApp((s) => s.annotations);
  const shapes = useApp((s) => s.shapes);
  const regionShades = useApp((s) => s.regionShades);
  const seriesStyles = useApp((s) => s.seriesStyles);
  const seriesLabels = useApp((s) => s.seriesLabels);
  const waterfall = useApp((s) => s.waterfall);
  const excludedDisplay = useApp((s) => s.excludedDisplay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const y2Lim = useApp((s) => s.y2Lim);
  const y2Scale = useApp((s) => s.y2Scale);
  const y2Step = useApp((s) => s.y2Step);
  const errKeys = useApp((s) => s.errKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const hiddenChannels = useApp((s) => s.hiddenChannels);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  // Item 18 (per-window background override): PlotStage always renders the
  // FOCUSED window (whether the sole maximized default, or the focused frame
  // inside an MDI canvas — see WindowCanvas), so its own `bg` is looked up by
  // the CURRENT focusedWindowId rather than threaded in as a prop. A derived
  // string selector — re-renders only when the RESULT changes, not a
  // `plotWindows` array-identity dependency.
  const winBg = useApp((s) => s.plotWindows.find((w) => w.id === s.focusedWindowId)?.bg);
  const { axesBg, inkColor, isDark: isDarkBg } = resolvePlotBg(winBg);
  // Item 13 (cross-window link groups): the FOCUSED window's own link group,
  // looked up the same way as `winBg` above (a derived primitive selector,
  // never a `plotWindows` array-identity dependency). Resolved to the uPlot
  // sync key (or undefined = unlinked) for PlotViewport.
  const winLinkGroup = useApp(
    (s) => s.plotWindows.find((w) => w.id === s.focusedWindowId)?.linkGroup ?? null,
  );
  const tool = useApp((s) => s.plotTool);
  const setPlotTool = useApp((s) => s.setPlotTool);
  // MAIN #18: pointer-mode annotation select/drag/resize/edit/menu bridge.
  const { bridge: annotationEdit, menu: annotationMenu, closeMenu: closeAnnotationMenu } = useAnnotationEdit(tool);
  const { bridge: axisLabelEdit, menu: axisLabelMenu, closeMenu: closeAxisLabelMenu } = useAxisLabelEdit(tool);
  // MAIN #27: pointer-mode shape select/move/reshape/menu bridge + the
  // drag-to-draw-a-new-shape mode bridge.
  const { bridge: shapeEdit, menu: shapeMenu, closeMenu: closeShapeMenu } = useShapeEdit(tool);
  const { shapeDraw } = useShapeDraw();
  const setRegionPicked = useApp((s) => s.setRegionPicked);
  const selection = useApp((s) => s.selection);
  const setRowSelection = useApp((s) => s.setRowSelection);
  const integral = useApp((s) => s.integral);
  const fwhmResult = useApp((s) => s.fwhmResult);
  const setIntegral = useApp((s) => s.setIntegral);
  const setFwhmResult = useApp((s) => s.setFwhmResult);
  const setQfitRoi = useApp((s) => s.setQfitRoi);
  const setGadgetCursors = useApp((s) => s.setGadgetCursors);
  const gadgetMode = useApp((s) => s.gadgetMode);
  const gadget = useGadgetChip();
  const onAxisDrop = useAxisDrop();
  // stack/inset/polar values gate the alternate render modes here; their toggle
  // setters live in PlotToolbar, which owns the tool dock.
  const stackMode = useApp((s) => s.stackMode);
  // Set by applyOriginFigure's spatial multi-panel path (decode-plan #36):
  // each panel owns its own dataset, so the plain "≥2 plotted channels on the
  // active dataset" gate below doesn't apply — a spatial arrangement can be
  // shown even with 0/1 channels selected on whatever is active.
  const spatialPanels = useApp((s) => s.spatialPanels);
  // Set by `facetByColumn` (gap #21 residual): same reasoning as above — a
  // facet arrangement is its own explicit-intent gate, independent of the
  // active dataset's plotted-channel count.
  const facetPanels = useApp((s) => s.facetPanels);
  const insetMode = useApp((s) => s.insetMode);
  const polarMode = useApp((s) => s.polarMode);
  const statMode = useApp((s) => s.statMode);
  const fitOverlay = useApp((s) => s.fitOverlay);
  const peakOverlay = useApp((s) => s.peakOverlay);
  const baselineOverlay = useApp((s) => s.baselineOverlay);
  const derivOverlay = useApp((s) => s.derivOverlay);
  // Peak wizard click-on-plot marker editing (item 5) — non-null only while
  // the wizard's step ② is live (see usePeakWizard's store bridge).
  const peakWizardEdit = useApp((s) => s.peakWizardEdit);
  // Anchor-point baseline editing (GOTO #2) — non-null only while the
  // Baseline workshop's "Anchor points" method is live (useBaseline's bridge).
  const baselineAnchorEdit = useApp((s) => s.baselineAnchorEdit);
  const plotRef = useRef<uPlot | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [statsSel, setStatsSel] = useState<RegionStats | null>(null);

  const { displayPayload, plotted, styleList, labelList, errorBars, colorByColumns, hidden } = usePlotPayload({
    active,
    yScale,
    xScale,
    xKey,
    yKeys,
    y2Keys,
    seriesOrder,
    seriesStyles,
    seriesLabels,
    errKeys,
    hiddenChannels,
    waterfall,
    excludedDisplay,
    fitOverlay,
    baselineOverlay,
    peakOverlay,
    derivOverlay,
    selection,
  });

  // Right-click state (menu position + the gesture-cancel-then-open handler)
  // lives in useStageContextMenu — kept PlotStage at its line-ceiling pin
  // while making room for ToolHud; see that file's header for why a live
  // drag no longer silently swallows the click. Called here (unconditionally,
  // before the alternate-render-mode early returns below) per the Rules of
  // Hooks — NOT down by those returns, where the old inline `menu` useState
  // never had to worry about it.
  const { menu, setMenu, onStageContextMenu } = useStageContextMenu(displayPayload);

  // The ruler is pinned to the active dataset's data coords, so clear it when we
  // leave measure mode or switch datasets (the uPlot rebuild already drops the
  // drawn segment; this resets the React-side readout). Leaving the gadget
  // (qfit) tool clears its ROI/cursors/chip/overlays too — unlike ∫/∩, none of
  // the gadget modes persist across tool switches (Escape does the same via
  // the chip's dismiss).
  useEffect(() => {
    setMeasurement(null);
    setStatsSel(null);
    if (tool !== "qfit") useApp.getState().clearQfit();
  }, [tool, active]);

  // ORIGIN_FILE_DECODE_PLAN #38: the active dataset may still be a lazy Origin
  // book (its `data` is just a small preview) — fetch its full data the
  // moment it's actually shown here. No-op if it isn't pending, or a fetch
  // for it is already in flight (ensureBookData is single-flight).
  useEffect(() => {
    if (active?.pending) useApp.getState().ensureBookData(active.id);
  }, [active?.id, active?.pending]);

  const { resetView, smartScale, savePng, copyData, snapshot } = usePlotStageActions(
    plotRef,
    displayPayload,
    active,
  );

  // Item 11 / MAIN #27 offset: the live-snapshot publish (see
  // useLiveSnapshotPublish's header).
  useLiveSnapshotPublish({
    active,
    polarMode,
    statMode,
    stackMode,
    plottedCount: plotted.length,
    spatialPanels,
    facetPanels,
    displayPayload,
    styleList,
    labelList,
    errorBars,
    plotted,
    colorByColumns,
    hidden,
  });

  // Alternate render modes (each self-contained; polar wins, then stats, then stack).
  if (polarMode && active) return <PolarStage />;
  if (statMode && active) return <StatStage />;
  if (
    stackMode &&
    (plotted.length >= 2 || (spatialPanels?.length ?? 0) >= 2 || (facetPanels?.length ?? 0) >= 1)
  )
    return <MultiPanelStage />;

  return (
    <AxisDropZones
      className={`qzk-stage tool-${tool}`}
      // "theme" (the default — no override on this window) omits the style
      // prop entirely, so the sole-maximized-window default path stays
      // byte-identical to pre-item-18 markup (decision #6's migration
      // guarantee); only an explicit "light"/"dark" pin renders an inline
      // background, painting over the `--axes-bg` the CSS class supplies.
      style={winBg && winBg !== "theme" ? { background: axesBg } : undefined}
      onContextMenu={onStageContextMenu}
      onAxisDrop={onAxisDrop}
    >
      <PlotViewport
        plotRef={plotRef}
        displayPayload={displayPayload}
        theme={theme}
        accent={accent}
        insetTop={52}
        frameVars // publish the plot-frame rect for the frame-anchored legend (decode #52)
        bg={winBg}
        syncKey={windowSyncKey(winLinkGroup)}
        yScale={yScale}
        xScale={xScale}
        xLim={xLim}
        yLim={yLim}
        xStep={xStep}
        yStep={yStep}
        y2Lim={y2Lim}
        y2Scale={y2Scale}
        y2Step={y2Step}
        xFmt={xFmt}
        yFmt={yFmt}
        showGrid={showGrid}
        axisBox={showAxisBox}
        fontSize={resolveTemplate(plotTemplate).fontSize}
        // A publication template sets its own line width; the "screen" default
        // defers to the user's Preferences default line width.
        baseLineWidth={plotTemplate === "screen" ? defaultLineWidth : resolveTemplate(plotTemplate).lineWidth}
        defaultTrace={defaultTrace}
        steppedPaths={STEPPED_PATHS}
        linearPaths={LINEAR_PATHS}
        pointsPaths={POINTS_PATHS}
        wheelZoom={wheelZoom}
        title={plotTitle}
        xAxisLabel={xAxisLabel}
        yAxisLabel={yAxisLabel}
        y2AxisLabel={y2AxisLabel}
        refLines={refLines}
        onRefLineMove={updateRefLine}
        annotations={annotations}
        annotationEdit={annotationEdit}
        axisLabelEdit={axisLabelEdit}
        shapes={shapes}
        shapeEdit={shapeEdit}
        shapeDraw={shapeDraw}
        regionShades={regionShades}
        seriesStyles={styleList}
        plotted={plotted}
        seriesLabels={labelList}
        errorBars={errorBars}
        colorByColumns={colorByColumns}
        hidden={hidden}
        tool={tool}
        onReadout={setReadout}
        onRegionSelect={(x0, x1) => {
          // Clamp to the plotted x-extent → baseline workshop; then exit the mode.
          if (!displayPayload) return;
          const range = clampPlottedRange(displayPayload.data[0] as (number | null)[], x0, x1);
          if (range) setRegionPicked(range);
          setPlotTool("zoom");
        }}
        // Plot-brush: dragged x-band → row indices (original order → worksheet).
        onRangeSelect={(x0, x1) => {
          if (!displayPayload) return;
          setRowSelection(rowsInXRange(displayPayload.data[0] as (number | null)[], x0, x1));
        }}
        onMeasure={setMeasurement}
        onStats={setStatsSel}
        integral={integral}
        fwhmResult={fwhmResult}
        onIntegrate={setIntegral}
        onFwhm={setFwhmResult}
        // Read imperatively (not a reactive dependency in PlotViewport) — the
        // plugin's own instance-local state tracks live drag moves between
        // rebuilds; this only seeds a FRESH instance after some OTHER dep
        // triggers one (e.g. a debounced fit landing). Keeping qfitRoi/
        // gadgetCursors off PlotViewport's dependency list avoids rebuilding
        // the whole plot (and orphaning the plugin's in-flight drag
        // listeners) on every ROI/cursor move.
        qfitRoi={useApp.getState().qfitRoi}
        onRoiChange={setQfitRoi}
        gadgetMode={gadgetMode}
        gadgetCursors={useApp.getState().gadgetCursors}
        onCursorsChange={setGadgetCursors}
        peakWizardEdit={peakWizardEdit}
        anchorEdit={baselineAnchorEdit}
      />
      <PlotStageMenus
        menu={menu}
        onCloseMenu={() => setMenu(null)}
        displayPayload={displayPayload}
        plotRef={plotRef}
        plotted={plotted}
        hidden={hidden}
        actions={{ resetView, smartScale, savePng, copyData, snapshot }}
        annotationMenu={annotationMenu}
        onCloseAnnotationMenu={closeAnnotationMenu}
        axisLabelMenu={axisLabelMenu}
        onCloseAxisLabelMenu={closeAxisLabelMenu}
        shapeMenu={shapeMenu}
        onCloseShapeMenu={closeShapeMenu}
      />

      {displayPayload && (
        <PlotToolbar
          onReset={resetView}
          onSmartScale={smartScale}
          onSavePng={savePng}
          onCopyData={copyData}
          onSnapshot={snapshot}
          onSnapshotWindow={snapshotToNewWindow}
        />
      )}
      {displayPayload && <ToolHud tool={tool} />}

      {insetMode && displayPayload && (
        <InsetPlot payload={displayPayload} styleList={styleList} />
      )}

      {!active && (
        <div
          className="qzk-ds-meta"
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
        >
          Select a dataset to plot
        </div>
      )}

      <PlotReadouts tool={tool} readout={readout} measurement={measurement} stats={statsSel} />
      <PlotResultChips
        integral={integral}
        fwhm={fwhmResult}
        onClearIntegral={() => setIntegral(null)}
        onClearFwhm={() => setFwhmResult(null)}
        gadget={gadget}
      />
      {displayPayload && showLegend && (
        <PlotLegend
          series={displayPayload.series}
          styleList={styleList}
          plotted={plotted}
          hidden={hidden}
          colorByColumns={colorByColumns}
          isDarkBg={isDarkBg}
          inkColor={inkColor}
          defaultTrace={defaultTrace}
        />
      )}
    </AxisDropZones>
  );
}
