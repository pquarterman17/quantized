// State + imperative uPlot-instance render effect for MultiPanelStage.tsx
// (kept a thin view, the `useStatStage`/`StatStage.tsx` precedent). Extracted
// so the view component stays under the ~400-line convention once a 4th mode
// (paneled x-breaks) landed. FOUR modes share one host div; which one is
// active is now STRUCTURAL rather than a precedence chain — the store's
// `composition` is a discriminated union (`lib/composition.ts`, #54 pass A),
// so at most one kind of panel array can be non-null at a time. See
// `MultiPanelStage.tsx`'s module doc for what each mode means; this file owns
// the payload-building effects and the one DOM-manipulating uPlot-instance
// effect.
//
// Parameterized over explicit params rather than store reads (MULTI_PLOT_PLAN
// item 15, the usePlotPayload precedent): the focused `MultiPanelStage` view
// feeds it the live singleton fields (byte-identical behavior — the params
// are the exact store-selected references this hook used to read itself),
// while a background window feeds ONLY the plain per-channel stack mode from
// its own `PlotView` snapshot (`windows/BackgroundAltModes.tsx` — spatial/
// facet/break arrangements are transient singleton state and stay
// focused-only). ZERO store value imports (types only).

import { type CSSProperties, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";

import {
  breakPanelsOf,
  facetPanelsOf,
  spatialPanelsOf,
  type Composition,
} from "../../lib/composition";
import { resolveSecondaryAxis, secondaryAxisFromPanel } from "../../lib/axisspec";
import { buildErrorColumns } from "../../lib/errorbars";
import { sharedXDomain, sharedYDomain } from "../../lib/facet";
import { effectiveChannels, fetchPlot, type PlotPayload } from "../../lib/plotdata";
import {
  DECIMATE_MIN_POINTS,
  decimationRequestEligible,
  defaultDecimateWidthHint, errorBindingsApplyToPlotted,
} from "../../lib/plotDecimate";
import {
  facetGridSize,
  spatialGridSize,
  spatialCellStyling,
  spatialPlottedChannels,
  splitPayload,
  xZoomSyncHook,
} from "../../lib/multipanel";
import {
  columnWidths,
  cumulativeOffsets,
  type PanelFit,
  rowBoundaryGaps,
  rowHeights,
  spatialPixelRects,
  suppressedXIndices,
} from "../../lib/panelLayout";
import type { PageSetup } from "../../lib/pagesetup";
import { scaleFromLog, type PlotBg } from "../../lib/plotview";
import type { AxisFormat, AxisScale, Dataset, DefaultTrace, RefLine, SeriesStyle } from "../../lib/types";
import { LINEAR_PATHS, POINTS_PATHS } from "../../lib/uplotPaths";
import { buildOpts } from "../../lib/uplotOpts";
import { frameVarsPlugin } from "../../lib/uplotFrameVars";
import type { Readout } from "../../lib/uplotTools";
import type { Accent, PlotTool, Theme } from "../../store/useApp";
import { renderBreakPanels, resizeBreakPanels } from "./breakPanelRender";
import { renderFacetGrid, resizeFacetGrid } from "./facetGridRender";
import { renderStackPanels, resizeStackPanels } from "./stackPanelRender";
import type { SpatialLegendEntry } from "./SpatialPanelLegend";

/** The focused stage's uPlot cursor-sync group (all its panels crosshair
 *  together). A background stack window passes its OWN per-window key instead
 *  so N windows' panel sets never cross-sync implicitly (cross-window linking
 *  stays the opt-in item-13 XY feature). */
export const MULTIPANEL_SYNC_KEY = "qz-multipanel";
const GRID_GAP = 8;
/** Stable "no renames" default: a fresh `{}` in the destructuring default
 *  would be referentially new on every render and re-run the render effect
 *  (which depends on `seriesLabels`) for nothing. */
const EMPTY_LABELS: Record<number, string> = {};

/** One spatial panel's fetched series plus its own error-bar map (built at
 *  fetch time — needs the panel's full DataStruct, not just the plotted
 *  payload — see the fetch effect below). */
interface SpatialFetch {
  payload: PlotPayload;
  errorBars: Map<number, (number | null)[]>;
}

export interface SpatialLegendPortal {
  key: string;
  target: HTMLDivElement;
  entries: SpatialLegendEntry[];
  title?: string;
  frameXY?: [number, number];
}

export interface MultiPanelStageState {
  hostRef: RefObject<HTMLDivElement | null>;
  hostStyle: CSSProperties;
  readout: Readout | null;
  tool: string;
  spatialLegends: SpatialLegendPortal[];
}

export interface MultiPanelStageParams {
  /** The dataset under the plain per-channel stack (the focused view passes
   *  the ACTIVE dataset; a background window passes its own bound dataset). */
  active: Dataset | null;
  /** Spatial-panel dataset lookup only — a background window (which never
   *  renders spatial arrangements) passes a stable empty list. */
  datasets: Dataset[];
  /** The transient panel arrangement (decode-plan #36 / gap #21) — focused-only
   *  singleton state; background windows pass null. */
  composition: Composition | null;
  /** How the spatial composition fills the host (#54). Optional so background
   *  windows (which never render spatial mode) can omit it; defaults to the
   *  PR #47 letterbox ("frames"). */
  panelFit?: PanelFit;
  /** The window's page model (#54 Stage 2) — the letterbox aspect for the
   *  "page" fit. Omitted/null on background windows and non-page fits. */
  pageSetup?: PageSetup | null;
  yScale: AxisScale;
  xScale: AxisScale;
  xLim: [number, number] | null;
  yLim: [number, number] | null;
  xFmt: AxisFormat;
  yFmt: AxisFormat;
  showGrid: boolean;
  showAxisBox: boolean;
  /** Same presentation inputs PlotViewport receives. Multi-panel modes must
   * not silently fall back to uPlot's 12px/1.5px/Line defaults. */
  fontSize?: number;
  baseLineWidth?: number;
  defaultTrace?: DefaultTrace;
  refLines: RefLine[];
  seriesStyles: Record<number, SeriesStyle>;
  /** Per-channel legend renames, keyed by dataset channel index (BUG-014).
   *  Honoured by the plain stack, the paneled x-break and the facet grid
   *  alike (round 4): `buildOpts` sets `legend: { show: false }` and
   *  `PlotStage.tsx` mounts this hook's view INSTEAD of `PlotViewport` +
   *  `PlotLegend`, so a panel's y-axis label (`uplotOpts`' `soloLabel`, fed
   *  by the same resolved `labels` array) is the one slot a series' name
   *  appears in — while the EXPORT of every one of those views carries the
   *  rename (`lib/figureSpec.ts`'s `series_styles[i].legend` for the stack
   *  and break views, which export as the flat figure;
   *  `lib/figureSpecFacets.ts` for the grid). SPATIAL is the exception: each
   *  decoded panel carries its own labels from the source figure
   *  (`multipanel.spatialCellStyling`). A background window renders the
   *  stack mode and, with a durable `facetKey` or saved `plot.axisBreaks.x`
   *  (`BackgroundPlotWindow`'s `durableComposition`), the facet grid or the
   *  x-break arrangement too — it passes its own `view.seriesLabels`. */
  seriesLabels?: Record<number, string>;
  /** P3.3 dash/marker cycle — SPATIAL mode only; see `spatialCellStyling`. */
  autoSeriesStyles?: boolean;
  xKey: number | null;
  yKeys: number[] | null;
  y2Keys: number[] | null;
  // Item A (PNR.opj Book14 Graph11 repro): the same "Y-error"-designated
  // column bug also hits the plain per-channel stack mode (any Origin book
  // manually stacked, not just an applied multi-layer figure) — these are
  // the SAME fields PlotStage/usePlotPayload already read for the
  // single-plot view, just threaded into this mode's own fetch/render below.
  errKeys: Record<number, number>;
  hiddenChannels: number[];
  seriesOrder: number[] | null;
  /** The focused view passes the live plot tool; a background window passes
   *  the inert "zoom" default (Key Decision 2 — non-interactive). */
  tool: PlotTool;
  theme: Theme;
  accent: Accent;
  /** This instance's uPlot cursor-sync group (`MULTIPANEL_SYNC_KEY` for the
   *  focused stage; a per-window key for a background stack window). */
  syncKey: string;
  /** Item-18 per-window background override, threaded into every panel's
   *  `buildOpts` so axis/grid/ink resolve against the window's actual page
   *  colour. The focused view passes undefined (≡ "theme" — byte-identical
   *  to the pre-item-15 calls, which never passed `bg`). */
  bg?: PlotBg;
  /** ORIGIN_FILE_DECODE_PLAN #38 lazy-book fetch trigger. A STORE ACTION
   *  (stable reference), called imperatively inside the fetch effects —
   *  deliberately NOT a dependency anywhere, mirroring the pre-item-15
   *  `useApp.getState().ensureBookData` idiom so every dependency list stays
   *  field-for-field identical. */
  ensureBookData: (id: string) => void;
}

export function useMultiPanelStage(params: MultiPanelStageParams): MultiPanelStageState {
  const {
    active,
    datasets,
    composition,
    panelFit = "frames",
    pageSetup,
    yScale,
    xScale,
    xLim,
    yLim,
    xFmt,
    yFmt,
    showGrid,
    showAxisBox,
    fontSize,
    baseLineWidth,
    defaultTrace,
    refLines,
    seriesStyles,
    seriesLabels = EMPTY_LABELS,
    autoSeriesStyles = false,
    xKey,
    yKeys,
    y2Keys,
    errKeys,
    hiddenChannels,
    seriesOrder,
    tool,
    theme,
    accent,
    syncKey,
    bg,
    ensureBookData,
  } = params;
  // The union's three faces. Each accessor returns the stored array BY
  // REFERENCE (or null), so these stay valid `useMemo`/effect dependencies.
  const rawSpatialPanels = spatialPanelsOf(composition);
  const facetPanels = facetPanelsOf(composition);
  const breakPanels = breakPanelsOf(composition);
  const hostRef = useRef<HTMLDivElement>(null);
  const plotsRef = useRef<uPlot[]>([]);
  // The fetched stack payload TOGETHER with the channels it was fetched for
  // (BUG-014 round 5, N4): `plotted` recomputes synchronously with the view
  // while `fetchPlot` resolves later, so per-panel labels/styles/error bars
  // derived from `plotted` briefly dressed the OLD payload's panels in the
  // NEW list (measured: 3 panels wearing a 2-entry label list). Derived from
  // this snapshot instead, the two cannot disagree.
  const [payload, setPayload] = useState<{ payload: PlotPayload; channels: number[] } | null>(null);
  const [spatialPayloads, setSpatialPayloads] = useState<(SpatialFetch | null)[]>([]);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [spatialLegends, setSpatialLegends] = useState<SpatialLegendPortal[]>([]);

  // Spatial panels whose dataset still exists (a removed dataset degrades to
  // dropping that one cell, never a crash).
  const panels = useMemo(
    () => (rawSpatialPanels ?? []).filter((p) => datasets.some((d) => d.id === p.datasetId)),
    [rawSpatialPanels, datasets],
  );
  const spatial = panels.length > 0;
  const grid = useMemo(() => spatialGridSize(panels), [panels]);

  // Paneled x-breaks (gap #21 residual) and facet grid. No precedence guard
  // needed: the union makes the kinds exclusive, and a composition is never
  // constructed around an EMPTY panel list — so a non-null array IS the mode.
  const breakMode = breakPanels !== null;
  const facet = facetPanels !== null;
  const facetGrid = useMemo(() => facetGridSize(facetPanels?.length ?? 0), [facetPanels]);
  // The explicit store xLim (a manual override / prior zoom) wins; otherwise
  // the union domain across every facet panel — one shared horizontal scale.
  const facetXLim = useMemo(
    () => (facet ? (xLim ?? sharedXDomain(facetPanels!)) : null),
    [facet, facetPanels, xLim],
  );
  // Break panels share ONE y-domain instead (each keeps its own x-range) — an
  // honest axis break only elides x, never y.
  const breakYLim = useMemo(
    () => (breakMode ? (yLim ?? sharedYDomain(breakPanels!)) : null),
    [breakMode, breakPanels, yLim],
  );

  // Channels actually drawn (y selection minus the x-axis channel), in order
  // — the plain per-channel stack mode only.
  const plotted = useMemo(
    () =>
      !spatial && !facet && !breakMode && active
        ? effectiveChannels(active.data, yKeys, xKey, active.channelRoles, seriesOrder).filter(
            (c) => !hiddenChannels.includes(c),
          )
        : [],
    [spatial, facet, breakMode, active, yKeys, xKey, seriesOrder, hiddenChannels],
  );
  const styleList = useMemo(() => (payload?.channels ?? []).map((ch) => seriesStyles[ch]), [payload, seriesStyles]);
  // One error-bar map per stacked panel (each panel is a single-series uPlot
  // instance, so its own column index is always 1 — see `buildErrorColumns`'s
  // 1-based keying). Mirrors `usePlotPayload.errorBars`, scoped per panel.
  const errorBarsList = useMemo(
    () => (active ? (payload?.channels ?? []).map((ch) => buildErrorColumns(active.data, [ch], errKeys)) : []),
    [active, payload, errKeys],
  );
  // BUG-014 round 4: the channel-keyed renames the facet leg already
  // projects (`facetGridRender`), projected for the two OTHER legs.
  // STACK: one entry per FETCHED channel in panel order — `splitPayload`
  // makes exactly one single-series panel per series of that payload, so the
  // same indexing `styleList` uses is correct here.
  const labelList = useMemo(() => (payload?.channels ?? []).map((ch) => seriesLabels[ch]), [payload, seriesLabels]);
  // BREAK: nothing to project here — each `BreakPanel` carries its OWN
  // `channels` list (resolved over that panel's x-slice, which with a null
  // `yKeys` can differ panel to panel), so `breakPanelRender` projects the
  // channel-keyed map per panel exactly as the facet leg does. Round 4
  // re-derived one list over the WHOLE dataset instead and guarded it with a
  // series-COUNT check, which equal-count/different-membership panels walked
  // straight through (BUG-014 round 5).

  useEffect(() => {
    let cancelled = false;
    if (spatial || facet || breakMode || !active) {
      setPayload(null);
      return;
    }
    // ORIGIN_FILE_DECODE_PLAN #38: the active dataset may still be a lazy
    // Origin book — trigger its full-data fetch; the payload below renders
    // from whatever `active.data` currently is (preview now, full once the
    // fetch lands and this effect re-runs off the `active` dependency).
    if (active.pending) ensureBookData(active.id);
    // P3.4: same server-side decimation hint usePlotPayload.ts requests for
    // the single-plot path — multi-panel never composes an overlay onto
    // `payload` (no composeDisplayPayload call in this file), so only the
    // error-bar/scatter guards apply, not the overlay-companion one.
    const decimateWidth =
      active.data.time.length > DECIMATE_MIN_POINTS &&
      decimationRequestEligible({
        defaultTrace,
        hasErrorBars: Object.keys(errKeys).length > 0,
        hasErrorSpans: errorBindingsApplyToPlotted(active.errorRoles, plotted, { xErrorRenders: false }), // M1: legacy Y-only bars here, no X-error rendering
        hasColorByColumns: false,
      })
        ? defaultDecimateWidthHint()
        : null;
    void fetchPlot(active.data, yScale === "log", xScale === "log", plotted, y2Keys, xKey, decimateWidth).then(
      (p) => {
        if (!cancelled) setPayload({ payload: p, channels: plotted });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [spatial, facet, breakMode, active, yScale, xScale, plotted, y2Keys, xKey, defaultTrace, errKeys]); // eslint-disable-line react-hooks/exhaustive-deps -- `ensureBookData` deliberately excluded: stable store-action reference, see its param doc above (R9).

  useEffect(() => {
    let cancelled = false;
    if (!spatial) {
      // Functional update that keeps the SAME [] reference when already
      // empty: a fresh `[]` literal here would be referentially unequal to
      // the prior empty state on every non-spatial render, triggering a
      // pointless extra render that re-runs (and re-builds) the uPlot
      // instances in the render effect below (it depends on
      // `spatialPayloads`) a second time on every facet/break/plain-stack
      // mount or mode switch.
      setSpatialPayloads((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    void Promise.all(
      panels.map((p) => {
        const ds = datasets.find((d) => d.id === p.datasetId);
        // Each panel owns its OWN dataset (decode-plan #36) — a spatial
        // multi-panel apply can bind several lazy books at once, so every
        // panel's own book needs its own fetch trigger (#38), not just the
        // "active" one.
        if (ds?.pending) ensureBookData(ds.id);
        if (!ds) return Promise.resolve(null);
        // Item A (PNR.opj Book14 Graph11 repro): drop this panel's Origin-
        // hidden channels (a "Y-error" column like dSA) from what's actually
        // fetched/plotted — the spatial grid's decoded legend is static and
        // cannot keep them toggle-able, unlike the single-plot path (see
        // `multipanel.spatialPlottedChannels`'s doc). y2Keys is filtered the
        // same way for consistency, though a hidden channel is never itself
        // curve-bound to y2 in practice.
        const plottedChannels = spatialPlottedChannels(p);
        // #54 pass B: the plotted∩y2 intersection comes from the shared
        // resolver, the same one both export paths use — `y2_keys` is a set
        // membership marker on the wire (lib/plotdata's `new Set(y2Keys)`),
        // so this is the identical selection expressed once instead of thrice.
        const y2 =
          resolveSecondaryAxis(plottedChannels, secondaryAxisFromPanel(p), {
            scale: p.yLog ? "log" : "linear",
            fmt: { mode: "auto", digits: 2 },
          })?.keys ?? null;
        // A panel carrying a merged y2 overlay (decode-plan #36 residual —
        // `originFigures.resolveSpatialPanels`) passes its OWN y2Keys so the
        // fetched payload tags those series `axis: 1`, same as the single-
        // plot double-Y apply.
        // P3.4: same size/error-bar/scatter gate as the plain-stack fetch
        // above, evaluated per-panel (each panel owns its own dataset + err
        // bindings). No overlay-companion concept here either.
        const panelDecimateWidth =
          ds.data.time.length > DECIMATE_MIN_POINTS &&
          decimationRequestEligible({
            defaultTrace,
            hasErrorBars: Object.keys(p.errKeys ?? {}).length > 0,
            hasErrorSpans: errorBindingsApplyToPlotted(ds.errorRoles, plottedChannels, { xErrorRenders: false }),
            hasColorByColumns: false,
          })
            ? defaultDecimateWidthHint()
            : null;
        return fetchPlot(ds.data, p.yLog, p.xLog, plottedChannels, y2, p.xKey, panelDecimateWidth).then(
          (fetched): SpatialFetch => ({
            payload: fetched,
            // Error-bar magnitudes for THIS panel's own dataset/designations
            // (`originFigures.figureChannelSelection` populated `p.errKeys`),
            // keyed to the SAME plottedChannels order the payload's series
            // are in.
            errorBars: buildErrorColumns(ds.data, plottedChannels, p.errKeys ?? {}),
          }),
        );
      }),
    ).then((ps) => {
      if (!cancelled) setSpatialPayloads(ps);
    });
    return () => {
      cancelled = true;
    };
  }, [spatial, panels, datasets, defaultTrace]); // eslint-disable-line react-hooks/exhaustive-deps -- `ensureBookData` deliberately excluded: stable store-action reference, see its param doc above (R9).

  useEffect(() => {
    const host = hostRef.current;
    const destroyAll = () => {
      plotsRef.current.forEach((p) => p.destroy());
      plotsRef.current = [];
    };
    if (!host) {
      destroyAll();
      return;
    }

    if (spatial) {
      if (spatialPayloads.length !== panels.length || spatialPayloads.some((p) => !p)) {
        destroyAll();
        setSpatialLegends((prev) => (prev.length === 0 ? prev : []));
        return;
      }
      destroyAll();
      host.replaceChildren();
      const w = host.clientWidth || 600;
      const h = host.clientHeight || 400;
      // Item B (decode-plan #36 residual, PNR.opj Graph11): row boundaries
      // vary per-pair (0 = flush shared-x "wall" seam, GRID_GAP otherwise) —
      // CSS Grid's `gap` is one uniform value, so the grid switched to
      // explicit pixel placement (`panelLayout`'s column/row math +
      // cumulative offsets) instead of `gridTemplateRows`/`gridTemplateColumns`
      // auto-sizing. Columns stay uniformly spaced (unchanged).
      const colW = columnWidths(grid.cols, w, GRID_GAP);
      const rowGaps = rowBoundaryGaps(panels, grid.rows, GRID_GAP);
      const rowH = rowHeights(grid.rows, h, rowGaps);
      const colLefts = cumulativeOffsets(colW, GRID_GAP);
      const rowTops = cumulativeOffsets(rowH, rowGaps);
      const decodedRects = spatialPixelRects(panels, w, h, panelFit, pageSetup);
      const suppressed = suppressedXIndices(panels);
      const divs: HTMLDivElement[] = [];
      const legends: SpatialLegendPortal[] = [];
      panels.forEach((p, i) => {
        const entry = spatialPayloads[i];
        if (!entry) return;
        const { payload: pp, errorBars } = entry;
        const rect = decodedRects?.[i] ?? {
          left: colLefts[p.col], top: rowTops[p.row], width: colW[p.col], height: rowH[p.row],
        };
        const div = document.createElement("div");
        div.className = "qzk-spatial-panel";
        div.style.position = "absolute";
        div.style.left = `${rect.left}px`;
        div.style.top = `${rect.top}px`;
        div.style.width = `${rect.width}px`;
        div.style.height = `${rect.height}px`;
        host.appendChild(div);
        divs.push(div);
        // Item A: styles/labels line up with the SAME hidden-filtered channel
        // order the payload was fetched in (`spatialPlottedChannels`), not
        // the raw `p.yKeys` (which still includes a dropped error column).
        const { cellStyles, cellLabels, cellCycle, legendEntries } = spatialCellStyling(p, autoSeriesStyles);
        const opts = buildOpts(pp, {
          width: rect.width,
          height: rect.height,
          // This panel's axis type is Origin's own decoded boolean (no
          // reciprocal concept — SpatialPanel stays log-only) — bridge via
          // scaleFromLog (MAIN #12 back-compat helper), same as the
          // single-plot Origin-apply path in store/useApp.ts.
          yScale: scaleFromLog(p.yLog),
          xScale: scaleFromLog(p.xLog),
          xLim: p.xLim,
          yLim: p.yLim,
          xStep: p.xStep,
          yStep: p.yStep,
          // This panel's OWN merged y2 overlay, when one was paired in
          // (decode-plan #36 residual) — mirrors the single-plot double-Y
          // apply's y2Lim/y2Scale/y2Step/y2AxisLabel, scoped to this cell.
          y2Lim: p.y2Lim ?? null,
          // #54 pass B: the y2Log -> AxisScale bridge lives in the shared
          // adapter (lib/axisspec.secondaryAxisFromPanel), so this render
          // path and the page-export path convert a decoded panel the SAME
          // way instead of each spelling out `scaleFromLog` themselves.
          y2Scale: secondaryAxisFromPanel(p).scale,
          y2Step: p.y2Step ?? null,
          y2AxisLabel: p.y2AxisLabel,
          xFmt,
          yFmt,
          showGrid,
          axisBox: showAxisBox,
          fontSize,
          baseLineWidth,
          defaultTrace,
          tool,
          onReadout: setReadout,
          seriesStyles: cellStyles,
          seriesCycle: cellCycle,
          seriesLabels: cellLabels,
          // Item A (PNR.opj Book14 Graph11 repro): draw whiskers for this
          // panel's Y-error-designated columns instead of the multi-panel
          // path silently rendering them (or, pre-fix, nothing at all).
          errorBars,
          // Item B: faithful per-layer x title (null = Origin decoded an
          // explicitly blank title — force blank, never synthesize).
          xAxisLabel: p.xAxisLabel,
          yAxisLabel: p.yAxisLabel,
          // Each panel's OWN layer's floating text (fix #5 — a multi-panel
          // apply used to drop every layer's annotations).
          annotations: p.annotations,
          // Already-decoded Rect* bands, scoped to this layer's own data
          // coordinates. The shared plugin draws them behind grid/data.
          regionShades: p.regionShades,
          bg,
          linearPaths: LINEAR_PATHS,
          pointsPaths: POINTS_PATHS,
        });
        opts.cursor = { ...opts.cursor, sync: { key: syncKey } };
        // Only a panel that actually owns decoded legend content needs the
        // frame-variable bridge. Keeping it conditional leaves every other
        // spatial uPlot's plugin set byte-for-byte unchanged.
        if (legendEntries.length > 0 || p.legendTitle) {
          opts.plugins = [...(opts.plugins ?? []), frameVarsPlugin(".qzk-spatial-panel")];
        }
        // Item B: blank x tick values + title on every panel with a flush
        // shared-x neighbor directly below it (only the run's bottom panel
        // keeps them) — same idiom the plain per-channel stack mode already
        // uses for its own bottom-panel-only x labels.
        if (suppressed.has(i) && opts.axes?.[0]) {
          opts.axes[0] = { ...opts.axes[0], label: undefined, values: (_u, splits) => splits.map(() => "") };
        }
        plotsRef.current.push(new uPlot(opts, pp.data, div));
        if (legendEntries.length > 0 || p.legendTitle) {
          const target = document.createElement("div");
          target.className = "qzk-spatial-legend-layer";
          div.appendChild(target);
          legends.push({
            key: `${p.datasetId}-${p.sourceFigureIds?.join("-") ?? i}`,
            target,
            entries: legendEntries,
            ...(p.legendTitle ? { title: p.legendTitle } : {}),
            ...(p.legendFrameXY ? { frameXY: p.legendFrameXY } : {}),
          });
        }
      });
      setSpatialLegends(legends);
      const ro = new ResizeObserver(() => {
        const width = host.clientWidth || w;
        const height = host.clientHeight || h;
        const cw = columnWidths(grid.cols, width, GRID_GAP);
        const rg = rowBoundaryGaps(panels, grid.rows, GRID_GAP);
        const rh = rowHeights(grid.rows, height, rg);
        const cl = cumulativeOffsets(cw, GRID_GAP);
        const rt = cumulativeOffsets(rh, rg);
        const resizedRects = spatialPixelRects(panels, width, height, panelFit, pageSetup);
        panels.forEach((p, idx) => {
          const div = divs[idx];
          const u = plotsRef.current[idx];
          if (!div || !u) return;
          const rect = resizedRects?.[idx] ?? {
            left: cl[p.col], top: rt[p.row], width: cw[p.col], height: rh[p.row],
          };
          div.style.left = `${rect.left}px`;
          div.style.top = `${rect.top}px`;
          div.style.width = `${rect.width}px`;
          div.style.height = `${rect.height}px`;
          u.setSize({ width: rect.width, height: rect.height });
        });
      });
      ro.observe(host);
      return () => {
        ro.disconnect();
        destroyAll();
      };
    }

    setSpatialLegends((prev) => (prev.length === 0 ? prev : []));

    if (breakMode) {
      const bPanels = breakPanels ?? [];
      if (bPanels.length === 0) {
        destroyAll();
        return;
      }
      destroyAll();
      host.replaceChildren();
      const box = { w: host.clientWidth || 600, h: host.clientHeight || 400 };
      plotsRef.current = renderBreakPanels(host, {
        panels: bPanels,
        // BUG-014: a break view's only visible label slot is the panel's
        // y-axis label, and its EXPORT carries the rename — so the renames
        // belong here for the same reason they belong on the facet leg below.
        // Channel-keyed, projected per panel through `BreakPanel.channels`.
        seriesLabels,
        syncKey,
        // Same x-zoom/pan sync idiom as the plain per-channel stack — a break
        // panel's x axis still means "this series' x", so zooming one seam
        // should pan/zoom the others together.
        onSetScale: xZoomSyncHook(() => plotsRef.current),
        box,
        cell: {
          yScale, xScale, yLim: breakYLim, xFmt, yFmt, showGrid,
          axisBox: showAxisBox, fontSize, baseLineWidth, defaultTrace,
          tool, onReadout: setReadout, bg,
        },
      });
      const ro = new ResizeObserver(() => resizeBreakPanels(host, plotsRef.current, box));
      ro.observe(host);
      return () => {
        ro.disconnect();
        destroyAll();
      };
    }

    if (facet) {
      const fPanels = facetPanels ?? [];
      if (fPanels.length === 0) {
        destroyAll();
        return;
      }
      destroyAll();
      host.replaceChildren();
      const box = { w: host.clientWidth || 600, h: host.clientHeight || 400 };
      plotsRef.current = renderFacetGrid(host, {
        panels: fPanels,
        // BUG-014: the grid used to pass NO renames at all, so a renamed
        // series read its derived "label (unit)" in every facet panel while
        // the flat plot read the rename. `buildOpts` applies these the same
        // way the flat path does, and `lib/figureSpecFacets.ts` applies the
        // SAME map on the export side -- so screen and export agree.
        seriesLabels,
        grid: facetGrid,
        gap: GRID_GAP,
        syncKey,
        // Same x-zoom/pan sync idiom as the plain per-channel stack below (one
        // shared hook instance for the whole panel set — the x axis means the
        // same thing in every facet panel too).
        onSetScale: xZoomSyncHook(() => plotsRef.current),
        box,
        cell: {
          yScale, xScale, xLim: facetXLim, xFmt, yFmt, showGrid,
          axisBox: showAxisBox, fontSize, baseLineWidth, defaultTrace,
          tool, onReadout: setReadout, bg,
        },
      });
      const ro = new ResizeObserver(() => resizeFacetGrid(host, plotsRef.current, facetGrid, GRID_GAP, box));
      ro.observe(host);
      return () => {
        ro.disconnect();
        destroyAll();
      };
    }

    if (!payload) {
      destroyAll();
      return;
    }
    destroyAll();
    host.replaceChildren();

    const w = host.clientWidth || 600;
    plotsRef.current = renderStackPanels(host, {
      panels: splitPayload(payload.payload),
      // BUG-014 round 4: each stack panel is single-series, so its y-axis
      // label IS that series' legend text — the rename has to reach it or
      // screen and export disagree.
      seriesLabels: labelList,
      seriesStyles: styleList,
      errorBars: errorBarsList,
      syncKey,
      // Propagate an x-zoom on one panel to all the others.
      onSetScale: xZoomSyncHook(() => plotsRef.current),
      box: { w, h: host.clientHeight || 400 },
      cell: {
        yScale, xScale, xLim, xFmt, yFmt, showGrid, axisBox: showAxisBox,
        fontSize, baseLineWidth, defaultTrace, refLines, tool,
        onReadout: setReadout, bg,
      },
    });

    const ro = new ResizeObserver(() => resizeStackPanels(host, plotsRef.current, w));
    ro.observe(host);
    return () => {
      ro.disconnect();
      destroyAll();
    };
  }, [
    spatial,
    spatialPayloads,
    panels,
    grid,
    panelFit, // #54: switching fit mode re-lays the spatial grid
    pageSetup, // #54 Stage 2: page dims/aspect change re-lays "page" fit
    breakMode,
    breakPanels,
    breakYLim,
    facet,
    facetPanels,
    facetGrid,
    facetXLim,
    payload,
    yScale,
    xScale,
    xLim,
    xFmt,
    yFmt,
    showGrid,
    showAxisBox,
    fontSize,
    baseLineWidth,
    defaultTrace,
    refLines,
    styleList,
    labelList,
    seriesLabels,
    autoSeriesStyles,
    errorBarsList,
    tool,
    theme,
    accent,
    // Item 15 additions — constant for the focused stage (MULTIPANEL_SYNC_KEY
    // / undefined) so its rebuild frequency is untouched; stable per
    // background window, where a bg-toggle SHOULD rebuild (item 18).
    syncKey,
    bg,
  ]);

  const hostStyle: CSSProperties = spatial
    ? // Item B: children are now explicitly pixel-positioned (`panelLayout`'s
      // column/row math), not CSS Grid `1fr` auto-sizing — CSS Grid's `gap`
      // is one uniform value and can't express a flush (0px) row boundary
      // next to a normal one. `position: absolute` here still establishes
      // the containing block the child divs' own `position: absolute`
      // resolves against.
      { position: "absolute", inset: 8 }
    : breakMode
      ? { position: "absolute", inset: 8, display: "flex", flexDirection: "row" }
      : facet
        ? {
            position: "absolute",
            inset: 8,
            display: "grid",
            gap: GRID_GAP,
            gridTemplateRows: `repeat(${facetGrid.rows}, 1fr)`,
            gridTemplateColumns: `repeat(${facetGrid.cols}, 1fr)`,
          }
        : { position: "absolute", inset: 8, display: "flex", flexDirection: "column", gap: 8 };

  return { hostRef, hostStyle, readout, tool, spatialLegends };
}
