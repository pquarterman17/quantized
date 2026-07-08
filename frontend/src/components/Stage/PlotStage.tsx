// The hero canvas: a uPlot instance wired to the active dataset via the
// backend /api/plot/series route (offline fallback builds columns locally).
// Re-styles on theme/accent change; resizes to its container.

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import {
  clampPlottedRange,
  composeDisplayPayload,
  effectiveChannels,
  fetchPlot,
  rowsInXRange,
  type PlotPayload,
} from "../../lib/plotdata";
import { droppedRows } from "../../lib/rowstate";
import { copyImage, copyText, payloadToTSV } from "../../lib/clipboard";
import { buildErrorColumns } from "../../lib/errorbars";
import type { Measurement } from "../../lib/measure";
import type { RegionStats } from "../../lib/regionStats";
import { exportPlotPng, plotPngBlob } from "../../lib/plotExport";
import { suggestLogScale } from "../../lib/autoscale";
import { resolveTemplate } from "../../lib/plotTemplates";
import { buildOpts } from "../../lib/uplotOpts";
import { LINEAR_PATHS, POINTS_PATHS, STEPPED_PATHS } from "../../lib/uplotPaths";
import type { Readout } from "../../lib/uplotTools";
import { useActiveDataset, useApp } from "../../store/useApp";
import { toast } from "../../store/toasts";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import AxisDropZones from "./AxisDropZones";
import InsetPlot from "./InsetPlot";
import MultiPanelStage from "./MultiPanelStage";
import PlotLegend from "./PlotLegend";
import PlotReadouts from "./PlotReadouts";
import PlotResultChips from "./PlotResultChips";
import PlotToolbar from "./PlotToolbar";
import PolarStage from "./PolarStage";
import StatStage from "./StatStage";
import { useAxisDrop } from "./useAxisDrop";
import { useGadgetChip } from "./useGadgetChip";

export default function PlotStage() {
  const active = useActiveDataset();
  const yLog = useApp((s) => s.yLog);
  const xLog = useApp((s) => s.xLog);
  const xLim = useApp((s) => s.xLim);
  const yLim = useApp((s) => s.yLim);
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
  const seriesStyles = useApp((s) => s.seriesStyles);
  const seriesLabels = useApp((s) => s.seriesLabels);
  const waterfall = useApp((s) => s.waterfall);
  const excludedDisplay = useApp((s) => s.excludedDisplay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const y2Lim = useApp((s) => s.y2Lim);
  const y2Log = useApp((s) => s.y2Log);
  const errKeys = useApp((s) => s.errKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const hiddenChannels = useApp((s) => s.hiddenChannels);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const tool = useApp((s) => s.plotTool);
  const setPlotTool = useApp((s) => s.setPlotTool);
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
  const insetMode = useApp((s) => s.insetMode);
  const polarMode = useApp((s) => s.polarMode);
  const statMode = useApp((s) => s.statMode);
  const fitOverlay = useApp((s) => s.fitOverlay);
  const peakOverlay = useApp((s) => s.peakOverlay);
  const baselineOverlay = useApp((s) => s.baselineOverlay);
  const derivOverlay = useApp((s) => s.derivOverlay);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [payload, setPayload] = useState<PlotPayload | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [statsSel, setStatsSel] = useState<RegionStats | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Rows dropped from the plot: manually excluded (#50) ∪ filter-failed (#53).
  const dropped = useMemo(() => droppedRows(active), [active]);

  // Fold overlays + exclusion mask + selection brush in (see composeDisplayPayload).
  const displayPayload = useMemo(
    () =>
      payload
        ? composeDisplayPayload(payload, {
            id: active?.id ?? null,
            waterfall,
            dropped,
            excludedDisplay,
            fitOverlay,
            baselineOverlay,
            peakOverlay,
            derivOverlay,
            selection,
          })
        : null,
    [
      payload,
      fitOverlay,
      peakOverlay,
      baselineOverlay,
      derivOverlay,
      waterfall,
      active,
      dropped,
      excludedDisplay,
      selection,
    ],
  );

  // Channels actually drawn (y selection minus the x-axis channel), in order.
  const plotted = useMemo(
    () => (active ? effectiveChannels(active.data, yKeys, xKey, active.channelRoles, seriesOrder) : []),
    [active, yKeys, xKey, seriesOrder],
  );

  // Map each display-series back to its dataset channel so the per-channel style
  // overrides land on the right line. Plotted channels come first (in yKeys order,
  // matching the backend), overlays after — those get `undefined` (defaults).
  const styleList = useMemo(() => {
    if (!displayPayload) return undefined;
    return displayPayload.series.map((_, i) =>
      i < plotted.length ? seriesStyles[plotted[i]] : undefined,
    );
  }, [displayPayload, plotted, seriesStyles]);

  // Legend-rename overrides, aligned 1:1 with the display series (overlays keep
  // their default labels). Drives the uPlot series label → legend, cursor
  // readout, and solo-axis label all read the renamed string.
  const labelList = useMemo(() => {
    if (!displayPayload) return undefined;
    return displayPayload.series.map((_, i) =>
      i < plotted.length ? seriesLabels[plotted[i]] : undefined,
    );
  }, [displayPayload, plotted, seriesLabels]);

  // Error-bar magnitudes per plotted series (keyed by uPlot data column = p+1).
  const errorBars = useMemo(
    () => (active ? buildErrorColumns(active.data, plotted, errKeys) : new Map<number, (number | null)[]>()),
    [active, plotted, errKeys],
  );

  // Interactive-legend visibility, aligned 1:1 with the display series (overlays
  // — index ≥ plotted.length — are never hidden).
  const hidden = useMemo(
    () =>
      displayPayload?.series.map((_, i) => i < plotted.length && hiddenChannels.includes(plotted[i])) ??
      undefined,
    [displayPayload, plotted, hiddenChannels],
  );

  // Fetch series whenever the active dataset, scale, or channel roles change.
  useEffect(() => {
    let cancelled = false;
    if (!active) {
      setPayload(null);
      return;
    }
    fetchPlot(active.data, yLog, xLog, plotted, y2Keys, xKey).then((p) => {
      if (!cancelled) setPayload(p);
    });
    return () => {
      cancelled = true;
    };
  }, [active, yLog, xLog, plotted, y2Keys, xKey]);

  // (Re)create the uPlot instance when payload / size / theme change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !displayPayload) {
      plotRef.current?.destroy();
      plotRef.current = null;
      return;
    }
    const w = host.clientWidth || 600;
    // uPlot's title div sits above the plot and its height is NOT counted in the
    // height we pass, so reserve room for it (matches the .u-title CSS height) to
    // keep the x-axis inside the overflow-hidden host.
    const titleH = plotTitle.trim() ? 24 : 0;
    const h = (host.clientHeight || 400) - titleH;
    plotRef.current?.destroy();
    plotRef.current = new uPlot(
      buildOpts(displayPayload, {
        width: w,
        height: h,
        yLog,
        xLog,
        xLim,
        yLim,
        y2Lim,
        y2Log,
        xFmt,
        yFmt,
        showGrid,
        axisBox: showAxisBox,
        fontSize: resolveTemplate(plotTemplate).fontSize,
        // A publication template sets its own line width; the "screen" default
        // defers to the user's Preferences default line width.
        baseLineWidth:
          plotTemplate === "screen" ? defaultLineWidth : resolveTemplate(plotTemplate).lineWidth,
        defaultTrace,
        steppedPaths: STEPPED_PATHS,
        linearPaths: LINEAR_PATHS,
        pointsPaths: POINTS_PATHS,
        wheelZoom,
        title: plotTitle,
        xAxisLabel,
        yAxisLabel,
        y2AxisLabel,
        refLines,
        onRefLineMove: updateRefLine,
        annotations,
        seriesStyles: styleList,
        seriesLabels: labelList,
        errorBars,
        hidden,
        tool,
        onReadout: setReadout,
        onRegionSelect: (x0, x1) => {
          // Clamp to the plotted x-extent → baseline workshop; then exit the mode.
          const range = clampPlottedRange(displayPayload.data[0] as (number | null)[], x0, x1);
          if (range) setRegionPicked(range);
          setPlotTool("zoom");
        },
        // Plot-brush: dragged x-band → row indices (original order → worksheet).
        onRangeSelect: (x0, x1) =>
          setRowSelection(rowsInXRange(displayPayload.data[0] as (number | null)[], x0, x1)),
        onMeasure: setMeasurement,
        onStats: setStatsSel,
        integral,
        fwhmResult,
        onIntegrate: setIntegral,
        onFwhm: setFwhmResult,
        // Read imperatively (not a reactive dependency below) — the plugin's
        // own instance-local state tracks live drag moves between rebuilds;
        // this only seeds a FRESH instance after some OTHER dep triggers one
        // (e.g. a debounced fit landing). Keeping qfitRoi/gadgetCursors off the
        // dependency list avoids rebuilding the whole plot (and orphaning the
        // plugin's in-flight drag listeners) on every ROI/cursor move.
        qfitRoi: useApp.getState().qfitRoi,
        onRoiChange: setQfitRoi,
        gadgetMode,
        gadgetCursors: useApp.getState().gadgetCursors,
        onCursorsChange: setGadgetCursors,
      }),
      displayPayload.data,
      host,
    );

    const ro = new ResizeObserver(() => {
      plotRef.current?.setSize({
        width: host.clientWidth || w,
        height: (host.clientHeight || 400) - titleH,
      });
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // theme/accent in deps so the plot recolors from fresh tokens; tool rebuilds
    // the cursor/drag config + plugins; gadgetMode swaps the qfit tool's plugin
    // (ROI band vs paired cursors) — a discrete pick, not a live-drag value.
  }, [displayPayload, yLog, xLog, xLim, yLim, y2Lim, y2Log, xFmt, yFmt, showGrid, showAxisBox, plotTemplate, defaultTrace, defaultLineWidth, wheelZoom, plotTitle, xAxisLabel, yAxisLabel, y2AxisLabel, refLines, annotations, styleList, labelList, errorBars, hidden, theme, accent, tool, integral, fwhmResult, gadgetMode]);

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

  function resetView() {
    if (plotRef.current && displayPayload) {
      plotRef.current.setData(displayPayload.data, true); // resetScales = re-fit
    }
  }

  // Smart auto-scale: pick log vs linear per axis from the plotted data's dynamic
  // range, then clear manual limits so the view re-fits. (#17)
  function smartScale() {
    if (!displayPayload) return;
    const cols = displayPayload.data as (number | null)[][];
    const xVals = cols[0] ?? [];
    const yVals: (number | null)[] = [];
    for (let s = 1; s < cols.length; s++) yVals.push(...cols[s]);
    const st = useApp.getState();
    st.setXLog(suggestLogScale(xVals));
    st.setYLog(suggestLogScale(yVals));
    st.setXLim(null);
    st.setYLim(null);
    st.setStatus("smart auto-scaled");
  }

  function savePng() {
    if (!plotRef.current) return;
    const stem = active?.name.replace(/\.[^.]+$/, "") ?? "plot";
    exportPlotPng(plotRef.current, `${stem}.png`);
  }

  // Copy exactly what's plotted (x + series, honoring x-channel / waterfall /
  // overlays) as TSV — paste straight into Origin / Excel / a notebook.
  function copyData() {
    if (!displayPayload) return;
    const nRows = displayPayload.data[0]?.length ?? 0;
    const nCols = displayPayload.series.length + 1; // + the x column
    copyText(payloadToTSV(displayPayload)).then((ok) =>
      useApp.getState().setStatus(
        ok ? `copied ${nRows}×${nCols} to clipboard` : "clipboard unavailable",
      ),
    );
  }

  // Snapshot: copy exactly what's on screen to the clipboard as a PNG — a quick
  // raster grab for pasting into notes/chat (distinct from the TSV copy and the
  // server-rendered vector Figure export). Falls back to a toast where the async
  // clipboard image API is unavailable (Firefox / insecure context).
  function snapshot() {
    const u = plotRef.current;
    if (!u) return;
    plotPngBlob(u).then(async (blob) => {
      if (!blob) {
        toast("snapshot failed", "danger");
        return;
      }
      const ok = await copyImage(blob);
      toast(ok ? "plot copied to clipboard" : "clipboard image unavailable", ok ? "ok" : "danger");
    });
  }

  // Alternate render modes (each self-contained; polar wins, then stats, then stack).
  const nPlotted = plotted.length;
  if (polarMode && active) return <PolarStage />;
  if (statMode && active) return <StatStage />;
  if (stackMode && (nPlotted >= 2 || (spatialPanels?.length ?? 0) >= 2)) return <MultiPanelStage />;

  // Right-click anywhere on the plot background → axes/view actions (the parity
  // surface for the MATLAB axes uicontextmenu). Legend right-clicks stop their own
  // propagation, so they don't fall through to this.
  const onStageContextMenu = (e: React.MouseEvent) => {
    if (!displayPayload) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const axesMenuItems = (): ContextMenuItem[] => {
    const s = useApp.getState();
    return [
      { label: "Reset view (autoscale)", run: resetView },
      { separator: true },
      { label: xLog ? "Linear X axis" : "Log X axis", run: () => s.setXLog(!xLog) },
      { label: yLog ? "Linear Y axis" : "Log Y axis", run: () => s.setYLog(!yLog) },
      { label: showGrid ? "Hide grid" : "Show grid", run: () => s.setShowGrid(!showGrid) },
      { label: showLegend ? "Hide legend" : "Show legend", run: () => s.setShowLegend(!showLegend) },
      { separator: true },
      { label: "Integrate tool (area under curve)", run: () => s.setPlotTool("integ") },
      { label: "Peak / FWHM tool", run: () => s.setPlotTool("fwhm") },
      { label: "Gadget tool (fit/integrate/stats/differentiate/FFT/cursors)", run: () => s.setPlotTool("qfit") },
      { label: "Measure tool (Δx, Δy)", run: () => s.setPlotTool("measure") },
      { separator: true },
      { label: "Copy plotted data (TSV)", run: copyData },
      { label: "Copy plot image (PNG)", run: snapshot },
      { label: "Save plot as PNG", run: savePng },
    ];
  };

  return (
    <AxisDropZones
      className={`qzk-stage tool-${tool}`}
      onContextMenu={onStageContextMenu}
      onAxisDrop={onAxisDrop}
    >
      <div ref={hostRef} style={{ position: "absolute", inset: 8 }} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={axesMenuItems()} onClose={() => setMenu(null)} />}

      {displayPayload && (
        <PlotToolbar
          onReset={resetView}
          onSmartScale={smartScale}
          onSavePng={savePng}
          onCopyData={copyData}
          onSnapshot={snapshot}
        />
      )}

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
        <PlotLegend series={displayPayload.series} styleList={styleList} plotted={plotted} hidden={hidden} />
      )}
    </AxisDropZones>
  );
}
