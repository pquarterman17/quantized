// Multi-panel plot, four modes sharing one host (all state + the imperative
// uPlot-instance render effect live in `useMultiPanelStage.ts` — this file is
// a thin view, the `useStatStage`/`StatStage.tsx` precedent):
//  1) Plain per-channel stack: each plotted channel of the ACTIVE dataset
//     gets its own vertically-stacked uPlot panel sharing the x-axis.
//     Box-zoom/pan on any panel syncs the x-range to the others (setScale
//     hook), and the cursor crosshair syncs via uPlot's sync group. Only the
//     bottom panel shows x tick labels so the panels align.
//  2) Spatial multi-panel (decode-plan #36): `store.spatialPanels`, set by
//     `applyOriginFigure` when a multi-layer Origin figure's layers all
//     resolve, arranges EACH panel's OWN dataset + channel selection + fixed
//     axis state per the source page's layout (`lib/originPanels.
//     computePanelLayout` for row/col placement; `lib/panelLayout` for the
//     pixel geometry). Panels are independent — no x-sync, since they may
//     plot entirely unrelated datasets/quantities. Each panel also draws its
//     own Origin Y-error whiskers (`lib/errorbars.buildErrorColumns`,
//     item A — a "Y-error"-designated column like PNR.opj's `dSA` used to
//     render as a spurious series). Panels vertically adjacent in the same
//     grid column that share an x-range (item B, PNR.opj Graph11's 8-panel
//     spin-asymmetry figure) sit FLUSH — no gap, every panel still fully
//     boxed (`showAxisBox`) — with x tick values/title shown only on the
//     bottom panel of each such run (`lib/panelLayout.rowBoundaryGaps` /
//     `suppressedXIndices`); an Origin layer's own EXPLICITLY blank x_title
//     renders as no title rather than a synthesized one (see
//     `originFigures.resolveFigurePanels`'s `xAxisLabel` doc).
//  3) Facet grid (gap #21 residual): `store.facetPanels`, set by the
//     `facetByColumn` action, arranges one small-multiples panel per distinct
//     level of a chosen column in a sqrt-balanced CSS grid
//     (`lib/multipanel.facetGridSize`). Unlike spatial panels, every facet
//     panel is a ROW-FILTERED SLICE of the SAME dataset/channels — already
//     materialized as a `PlotPayload` by `lib/facet.facetPayloads`, so this
//     mode needs no fetch — and shares ONE x-domain across all panels
//     (`lib/facet.sharedXDomain`), with box-zoom/pan sync like the plain
//     stack (same idiom, since the x AXIS means the same thing in every
//     panel). Each panel's uPlot `title` shows its facet level.
//  4) Paneled x-breaks (gap #21 LAST residual): `store.breakPanels`, set by
//     the `breakAtGaps` action, splits ONE series at large x-gaps
//     (`lib/facet.suggestBreaks` or an explicit override) into adjacent
//     panels laid out in a single row (`lib/multipanel.breakPanelWidths`),
//     with a diagonal break-glyph seam between each pair. Unlike facet, break
//     panels each keep their OWN local x-range but share ONE y-domain
//     (`lib/facet.sharedYDomain`) — an honest axis break only elides x.
//  Precedence when more than one is populated (the store keeps them mutually
//  exclusive, but the hook renders defensively): spatial > break > facet >
//  plain stack.
// Self-contained — fetches its own series; overlays/waterfall stay single-view.
//
// This file is the thin FOCUSED-window wrapper (MULTI_PLOT_PLAN item 15): it
// reads the live singleton store fields and feeds them to the parameterized
// `useMultiPanelStage` — a background window feeds ONLY the plain stack mode
// from its own `PlotView` snapshot (`windows/BackgroundAltModes.tsx`).

import "uplot/dist/uPlot.min.css";

import { createPortal } from "react-dom";

import { runExportSpatialPageCommand } from "../../lib/exportPageCommand";
import { resolveTemplate } from "../../lib/plotTemplates";
import { canExportSpatialPage } from "../../lib/spatialPageExport";
import { resolvePlotBg } from "../../lib/uplotOpts";
import { useActiveDataset, useApp } from "../../store/useApp";
import { MULTIPANEL_SYNC_KEY, useMultiPanelStage } from "./useMultiPanelStage";
import SpatialPanelLegend from "./SpatialPanelLegend";

export default function MultiPanelStage() {
  const setStackMode = useApp((s) => s.setStackMode);
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const spatialPanels = useApp((s) => s.spatialPanels);
  const facetPanels = useApp((s) => s.facetPanels);
  const breakPanels = useApp((s) => s.breakPanels);
  const yScale = useApp((s) => s.yScale);
  const xScale = useApp((s) => s.xScale);
  const xLim = useApp((s) => s.xLim);
  const yLim = useApp((s) => s.yLim);
  const xFmt = useApp((s) => s.xFmt);
  const yFmt = useApp((s) => s.yFmt);
  const showGrid = useApp((s) => s.showGrid);
  const showLegend = useApp((s) => s.showLegend);
  const showAxisBox = useApp((s) => s.showAxisBox);
  const plotTemplate = useApp((s) => s.plotTemplate);
  const defaultLineWidth = useApp((s) => s.defaultLineWidth);
  const defaultTrace = useApp((s) => s.defaultTrace);
  const refLines = useApp((s) => s.refLines);
  const seriesStyles = useApp((s) => s.seriesStyles);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const y2Keys = useApp((s) => s.y2Keys);
  const errKeys = useApp((s) => s.errKeys);
  const hiddenChannels = useApp((s) => s.hiddenChannels);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const plotTool = useApp((s) => s.plotTool);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const panelFit = useApp((s) => s.panelFit);
  const setPanelFit = useApp((s) => s.setPanelFit);
  const pageSetup = useApp((s) => s.pageSetup);
  const ensureBookData = useApp((s) => s.ensureBookData);
  const template = resolveTemplate(plotTemplate);
  const { hostRef, hostStyle, readout, tool, spatialLegends } = useMultiPanelStage({
    active,
    datasets,
    spatialPanels,
    facetPanels,
    breakPanels,
    panelFit,
    pageSetup,
    yScale,
    xScale,
    xLim,
    yLim,
    xFmt,
    yFmt,
    showGrid,
    showAxisBox,
    fontSize: template.fontSize,
    baseLineWidth: plotTemplate === "screen" ? defaultLineWidth : template.lineWidth,
    defaultTrace,
    refLines,
    seriesStyles,
    xKey,
    yKeys,
    y2Keys,
    errKeys,
    hiddenChannels,
    seriesOrder,
    tool: plotTool,
    theme,
    accent,
    syncKey: MULTIPANEL_SYNC_KEY,
    // bg deliberately omitted (≡ "theme"): the focused stack keeps rendering
    // exactly as before item 15 — see the item-18 note in MULTI_PLOT_PLAN.
    ensureBookData,
  });
  const { inkColor, isDark: isDarkBg } = resolvePlotBg();

  return (
    <div className="qzk-stage">
      <div ref={hostRef} style={hostStyle} />
      {showLegend
        ? spatialLegends.map((legend) =>
            createPortal(
              <SpatialPanelLegend
                entries={legend.entries}
                title={legend.title}
                frameXY={legend.frameXY}
                isDarkBg={isDarkBg}
                inkColor={inkColor}
              />,
              legend.target,
              legend.key,
            ),
          )
        : null}
      <div className="qzk-glass qzk-float-tools">
        <button
          className="qzk-tool-btn active"
          title="Back to a single overlaid plot"
          onClick={() => setStackMode(false)}
        >
          ▤
        </button>
        {/* #54: spatial multi-panel fit — aspect-preserving letterbox vs fill.
            Only shown for a decoded spatial arrangement (the only mode that
            reads panelFit); the plain stack / facet / break modes ignore it. */}
        {spatialPanels && (
          <>
            <button
              className={`qzk-tool-btn${panelFit === "frames" ? " active" : ""}`}
              title="Fit: preserve the figure's aspect ratio (letterbox)"
              onClick={() => setPanelFit("frames")}
            >
              ▭
            </button>
            <button
              className={`qzk-tool-btn${panelFit === "window" ? " active" : ""}`}
              title="Fill: stretch the panels to fill the window"
              onClick={() => setPanelFit("window")}
            >
              ⛶
            </button>
            {/* Page fit only when this window has a page model (#54 Stage 2). */}
            {pageSetup && (
              <button
                className={`qzk-tool-btn${panelFit === "page" ? " active" : ""}`}
                title="Page: place panels at their true page coordinates"
                onClick={() => setPanelFit("page")}
              >
                ▦
              </button>
            )}
            {/* #54 residual: export the page at TRUE page coordinates (the
                same decoded pageRect geometry the "page" fit renders on
                screen). Fail-closed like the button above it — omitted
                (never a disabled/greyed button) unless every panel actually
                has a valid page position, so this never silently falls back
                to the grid layout. */}
            {canExportSpatialPage(spatialPanels, pageSetup) && (
              <button
                className="qzk-tool-btn"
                title="Export page… (true page coordinates)"
                onClick={() => void runExportSpatialPageCommand(useApp.getState)}
              >
                ⤓
              </button>
            )}
          </>
        )}
      </div>
      {tool === "cursor" && readout && (
        <div className="qzk-glass qzk-readout">
          <div style={{ color: "var(--text-dim)" }}>x = {readout.x.toPrecision(5)}</div>
          {readout.rows.map((r, i) => (
            <div key={`${r.label}-${i}`} style={{ display: "flex", gap: 6, justifyContent: "space-between" }}>
              <span>{r.label || "y"}</span>
              <span>{r.y.toPrecision(5)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
