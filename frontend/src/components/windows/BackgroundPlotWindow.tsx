// The BACKGROUND (unfocused) plot window's content (MULTI_PLOT_PLAN item 4,
// Key Decision 2): live data driven by the window's OWN `PlotView` snapshot
// rather than the live singleton store fields — and with NO interactive tool
// plugins (no toolbar/legend/readouts/context menu either — a background
// window is a plain live preview). `PlotWindowFrame`'s capture-phase
// pointerdown handler focuses the window (which snapshot-swaps it to a
// `PlotStage` in the next render) before any drag gesture could reach this
// component, so it never needs its own pointerdown handling.
//
// Item 15: this file is the render-MODE dispatcher. The view's mode flags
// pick the content, with the exact precedence PlotStage's focused
// early-returns use (polar > stat > stack > plain XY) — so a window whose
// snapshot carries `polarMode`/`statMode`/`stackMode` shows that mode even
// while unfocused, fed from its OWN view while the singletons hold whatever
// the focused window is doing. The spatial/facet/break panel arrangements
// (and PlotStage's spatial/facet stack gates) are transient SINGLETON state,
// deliberately absent here — a background stack window is always the plain
// per-channel stack. Cross-window link groups (item 13) stay XY-only: the
// `linkGroup` prop is threaded into the XY path's viewport ONLY, never into
// the alternate mode cores (a stack window's panels sync among THEMSELVES
// via a per-window key — see `BackgroundAltModes.tsx`).
//
// Row exclusion/filter still apply (via the shared usePlotPayload → the #50/
// #53 `lib/rowstate` chokepoint — and `analysisData` inside the stat mode),
// so N windows on the same dataset all reflect a live exclusion toggle
// together — the item-4 row-state proof, extended per-mode by the item-15
// tests.

import { useRef } from "react";
import type uPlot from "uplot";

import { effectiveChannels } from "../../lib/plotdata";
import type { PlotBg, PlotView } from "../../lib/plotview";
import { resolveTemplate } from "../../lib/plotTemplates";
import type { Dataset } from "../../lib/types";
import { LINEAR_PATHS, POINTS_PATHS, STEPPED_PATHS } from "../../lib/uplotPaths";
import { windowSyncKey } from "../../lib/windowsync";
import { useApp } from "../../store/useApp";
import InsetPlot from "../Stage/InsetPlot";
import PlotViewport from "../Stage/PlotViewport";
import { usePlotPayload } from "../Stage/usePlotPayload";
import {
  BackgroundPolarWindow,
  BackgroundStackWindow,
  BackgroundStatWindow,
} from "./BackgroundAltModes";

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
  /** This window's cross-window link group (item 13) — null/undefined =
   *  unlinked. A LINKED background window still participates in cursor +
   *  x-range sync (that's the whole point: compare it against the focused
   *  window point-by-point); it stays non-interactive otherwise. XY-only —
   *  see the module doc. */
  linkGroup?: number | null;
}

export default function BackgroundPlotWindow({
  dataset,
  view,
  bg,
  linkGroup,
}: BackgroundPlotWindowProps) {
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
  // Item 15 mode dispatch — the same precedence as PlotStage's focused
  // early-returns (polar wins, then stats, then stack). The stack gate
  // mirrors PlotStage's `nPlotted >= 2` (its spatial/facet gates are
  // singleton-only, see the module doc).
  if (view.polarMode) return <BackgroundPolarWindow dataset={dataset} view={view} />;
  if (view.statMode) return <BackgroundStatWindow dataset={dataset} view={view} />;
  if (
    view.stackMode &&
    effectiveChannels(dataset.data, view.yKeys, view.xKey, dataset.channelRoles, view.seriesOrder)
      .length >= 2
  )
    return <BackgroundStackWindow dataset={dataset} view={view} bg={bg} />;
  return <BackgroundXYWindow dataset={dataset} view={view} bg={bg} linkGroup={linkGroup} />;
}

/** The plain-XY background content (items 4/13/18): the SAME
 *  `usePlotPayload` → `PlotViewport` pipeline the focused window uses, fed by
 *  the window's own view; overlays forced null (Key Decision 2). */
function BackgroundXYWindow({
  dataset,
  view,
  bg,
  linkGroup,
}: BackgroundPlotWindowProps & { dataset: Dataset }) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const defaultTrace = useApp((s) => s.defaultTrace);
  const defaultLineWidth = useApp((s) => s.defaultLineWidth);
  const excludedDisplay = useApp((s) => s.excludedDisplay);
  const plotRef = useRef<uPlot | null>(null);

  const { displayPayload, plotted, styleList, labelList, errorBars, colorByColumns, hidden } = usePlotPayload({
    active: dataset,
    yScale: view.yScale,
    xScale: view.xScale,
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

  return (
    <>
      <PlotViewport
        plotRef={plotRef}
        displayPayload={displayPayload}
        theme={theme}
        accent={accent}
        yScale={view.yScale}
        xScale={view.xScale}
        xLim={view.xLim}
        yLim={view.yLim}
        xStep={view.xStep}
        yStep={view.yStep}
        y2Lim={view.y2Lim}
        y2Scale={view.y2Scale}
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
        regionShades={view.regionShades}
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
        bg={bg}
        syncKey={windowSyncKey(linkGroup)}
      />
      {/* Item 15: the magnifier inset is part of the view (`insetMode` ∈
          PlotView), so a background window carrying it keeps showing it —
          previously it was silently dropped while unfocused. Its own drag-
          zoom/close affordances are moot here: the frame's capture-phase
          pointerdown focuses the window first (decision #2). */}
      {view.insetMode && displayPayload && (
        <InsetPlot payload={displayPayload} styleList={styleList} />
      )}
    </>
  );
}
