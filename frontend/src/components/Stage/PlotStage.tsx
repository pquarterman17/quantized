// The hero canvas: a uPlot instance wired to the active dataset via the
// backend /api/plot/series route (offline fallback builds columns locally).
// Re-styles on theme/accent change; resizes to its container.

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

import {
  applyWaterfall,
  effectiveChannels,
  fetchPlot,
  withBaselineOverlay,
  withFitOverlay,
  withPeakOverlay,
  type PlotPayload,
} from "../../lib/plotdata";
import { copyText, payloadToTSV } from "../../lib/clipboard";
import { buildErrorColumns } from "../../lib/errorbars";
import type { Measurement } from "../../lib/measure";
import type { RegionStats } from "../../lib/regionStats";
import { exportPlotPng } from "../../lib/plotExport";
import { normalizeRange } from "../../lib/regionSelect";
import { suggestLogScale } from "../../lib/autoscale";
import { resolveTemplate } from "../../lib/plotTemplates";
import { buildOpts } from "../../lib/uplotOpts";
import type { Readout } from "../../lib/uplotPlugins";
import { useActiveDataset, useApp } from "../../store/useApp";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import InsetPlot from "./InsetPlot";
import MultiPanelStage from "./MultiPanelStage";
import PlotLegend from "./PlotLegend";
import PlotReadouts from "./PlotReadouts";
import PlotToolbar from "./PlotToolbar";
import PolarStage from "./PolarStage";

// Step-after path builder for the "Step" default trace, made once (uPlot owns
// the runtime; uplotOpts stays a pure options builder and receives this).
const STEPPED_PATHS = uPlot.paths?.stepped?.({ align: 1 });

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
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const errKeys = useApp((s) => s.errKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const hiddenChannels = useApp((s) => s.hiddenChannels);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const tool = useApp((s) => s.plotTool);
  const setPlotTool = useApp((s) => s.setPlotTool);
  const setRegionPicked = useApp((s) => s.setRegionPicked);
  // stack/inset/polar values gate the alternate render modes here; their toggle
  // setters live in PlotToolbar, which owns the tool dock.
  const stackMode = useApp((s) => s.stackMode);
  const insetMode = useApp((s) => s.insetMode);
  const polarMode = useApp((s) => s.polarMode);
  const fitOverlay = useApp((s) => s.fitOverlay);
  const peakOverlay = useApp((s) => s.peakOverlay);
  const baselineOverlay = useApp((s) => s.baselineOverlay);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [payload, setPayload] = useState<PlotPayload | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [statsSel, setStatsSel] = useState<RegionStats | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Splice in the fit curve + peak markers (each a no-op unless it belongs to
  // the active dataset and aligns to the plotted x).
  const displayPayload = useMemo(() => {
    if (!payload) return null;
    const id = active?.id ?? null;
    // Waterfall offsets the channels first (channel 0 stays put), then overlays
    // (fit/peak/baseline target channel 0) land in register on top.
    const base = applyWaterfall(payload, waterfall);
    const withFit = withFitOverlay(base, fitOverlay, id);
    const withBase = withBaselineOverlay(withFit, baselineOverlay, id);
    return withPeakOverlay(withBase, peakOverlay, id);
  }, [payload, fitOverlay, peakOverlay, baselineOverlay, waterfall, active]);

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
        wheelZoom,
        title: plotTitle,
        xAxisLabel,
        yAxisLabel,
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
          // Clamp to the plotted x-extent (x is monotonic, so the ends bound it),
          // then hand the ordered range to the baseline workshop and exit the mode.
          const xs = displayPayload.data[0] as number[];
          const lo = xs.length ? Math.min(xs[0], xs[xs.length - 1]) : undefined;
          const hi = xs.length ? Math.max(xs[0], xs[xs.length - 1]) : undefined;
          const range = normalizeRange(x0, x1, { min: lo, max: hi });
          if (range) setRegionPicked(range);
          setPlotTool("zoom");
        },
        onMeasure: setMeasurement,
        onStats: setStatsSel,
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
    // the cursor/drag config + plugins.
  }, [displayPayload, yLog, xLog, xLim, yLim, xFmt, yFmt, showGrid, showAxisBox, plotTemplate, defaultTrace, defaultLineWidth, wheelZoom, plotTitle, xAxisLabel, yAxisLabel, refLines, annotations, styleList, labelList, errorBars, hidden, theme, accent, tool]);

  // The ruler is pinned to the active dataset's data coords, so clear it when we
  // leave measure mode or switch datasets (the uPlot rebuild already drops the
  // drawn segment; this resets the React-side readout).
  useEffect(() => {
    setMeasurement(null);
    setStatsSel(null);
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

  // Alternate render modes (each self-contained; polar wins, then stack).
  const nPlotted = plotted.length;
  if (polarMode && active) return <PolarStage />;
  if (stackMode && nPlotted >= 2) return <MultiPanelStage />;

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
      { label: "Copy plotted data (TSV)", run: copyData },
      { label: "Save plot as PNG", run: savePng },
    ];
  };

  return (
    <div className={`qzk-stage tool-${tool}`} onContextMenu={onStageContextMenu}>
      <div ref={hostRef} style={{ position: "absolute", inset: 8 }} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={axesMenuItems()} onClose={() => setMenu(null)} />}

      {displayPayload && (
        <PlotToolbar onReset={resetView} onSmartScale={smartScale} onSavePng={savePng} onCopyData={copyData} />
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
      {displayPayload && showLegend && (
        <PlotLegend series={displayPayload.series} styleList={styleList} plotted={plotted} hidden={hidden} />
      )}
    </div>
  );
}
