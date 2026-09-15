// P4.2 canonical plot/project regression matrix — the SCREEN and EXPORT
// extractors. The REOPEN leg lives in `regressionMatrixReopen.testkit.ts`
// (module-size ceiling; see its header). See `regressionMatrix.testkit.ts` for
// the canonical payload, the rationale, and the documented limits of the
// comparison — including the two fields whose leg-to-leg equality is NOT
// independent evidence.
//
// Each extractor reads its OWN path's artifact:
//   projectScreen  -> the uPlot options object `lib/uplotOpts.ts` builds
//   projectExport  -> the FigureSpec `lib/figureSpec.ts` posts
//   projectReopen  -> the FigureDocument that comes back out of
//                     serializeWorkspace -> parseWorkspace
//
// None of them calls another, so an equality between two legs is evidence
// about the product and not about this file — with the two documented
// shared-input exceptions (`mode`, the facet partition).

import type uPlot from "uplot";

import { groupLevelLabel, levelOrderFor } from "./categorical";
import { breakPanelsOf } from "./composition";
import { buildErrorSpans, type ErrorSpan } from "./errorbars";
import {
  figureDocumentToPlotView,
  type FigureDocument,
} from "./figureDocument";
import type { FigureSpec } from "./api/figures";
import { buildFigureSpecFromDocument, resolveFigureDocumentData } from "./figureSpec";
import { durableComposition } from "./facet";
import { markerDecision } from "./markers";
import { channelModelingType } from "./modeling";
import { applyGroupSplit, groupSplitChannelMap } from "./plotGroupSplit";
import {
  buildColumns,
  categoricalXPayload,
  composeDisplayPayload,
  effectiveChannels,
  type PlotPayload,
} from "./plotdata";
import type { PlotView } from "./plotview";
import { droppedRows } from "./rowstate";
import { buildOpts } from "./uplotOpts";
import type { AxisScale, Dataset, DataStruct, SeriesStyle, StepMode } from "./types";
import {
  canonicalErrorsFromSpans,
  dashOf,
  decorOf,
  displayLabel,
  facetOf,
  figureMode,
  groupingOf,
  limitsOf,
  measureWaterfall,
  styleComparable,
  type CanonicalFigure,
  type CanonicalSeries,
} from "./regressionMatrix.testkit";

// ── screen leg ──────────────────────────────────────────────────────────────

// Sentinel path builders. `buildOpts` assigns exactly one of these to
// `series.paths` for a stepped series, so the STEP MODE the canvas resolved is
// recoverable by identity from the options object itself rather than re-read
// off the view. (Identity survives only for an ascending x column — a
// non-monotonic x wraps the builder; every matrix fixture uses ascending x.)
const STEP_POST = (() => undefined) as unknown as uPlot.Series.PathBuilder;
const STEP_PRE = (() => undefined) as unknown as uPlot.Series.PathBuilder;
const STEP_MID = (() => undefined) as unknown as uPlot.Series.PathBuilder;

function stepOf(paths: uPlot.Series.PathBuilder | undefined): StepMode | null {
  if (paths === STEP_POST) return "post";
  if (paths === STEP_PRE) return "pre";
  if (paths === STEP_MID) return "mid";
  return null;
}

function scaleOf(distr: number | undefined): AxisScale {
  return distr === 3 ? "log" : distr === 100 ? "reciprocal" : "linear";
}

/** uPlot's `Axis.label` is `string | ((self, …) => string)`; `buildOpts` only
 *  ever assigns a string (or blanks it), so anything else means the canvas
 *  stopped carrying a literal axis title and the comparison must see that. */
function axisLabelOf(label: uPlot.Axis.Label | undefined): string | null {
  return typeof label === "string" ? label : null;
}

function rangeOf(scale: uPlot.Scale | undefined): [number, number] | null {
  const range = scale?.range;
  return Array.isArray(range) && range.length === 2 && range.every((v) => typeof v === "number")
    ? [range[0] as number, range[1] as number]
    : null;
}

/** Everything the canvas resolved for one figure: the real `buildOpts` options
 *  object plus the inputs it was built from. Shared by `projectScreen` and
 *  `screenDrawnStyles` so there is exactly ONE mirror of the hook's pipeline in
 *  this file, not two. */
interface ScreenRender {
  mode: CanonicalFigure["mode"];
  view: ReturnType<typeof figureDocumentToPlotView>;
  data: DataStruct;
  groupCol: number | null;
  /** Dataset channel per DISPLAY position (group mode expands per level). */
  plotted: number[];
  /** The payload before and after `composeDisplayPayload` — the two the
   *  waterfall offset is measured between. */
  split: PlotPayload;
  display: PlotPayload;
  styleList: (SeriesStyle | undefined)[];
  spans: Map<number, ErrorSpan[]>;
  opts: ReturnType<typeof buildOpts>;
}

function renderScreen(figure: FigureDocument, dataset: Dataset): ScreenRender {
  const mode = figureMode(figure);
  const view = figureDocumentToPlotView(figure);
  const data = resolveFigureDocumentData(figure, dataset).data;
  const groupCol = mode === "group" ? view.groupKey : null;

  // A MIRROR of `components/Stage/usePlotPayload.ts`'s pipeline, in its order —
  // not the hook itself; see `regressionMatrix.testkit.ts`'s "KNOWN LIMITS"
  // for why, and for the one step (`dropTrailingEmptyRows`) it omits.
  const fetchChannels = effectiveChannels(
    data, view.yKeys, view.xKey, dataset.channelRoles, view.seriesOrder,
  );
  const groupCodes = groupCol !== null ? data.values.map((row) => row[groupCol]) : null;
  const plotted = groupCodes ? groupSplitChannelMap(fetchChannels, groupCodes) : fetchChannels;
  const base = buildColumns(data, view.y2Keys, view.xKey, fetchChannels);
  const xType = view.xKey == null ? "continuous" : channelModelingType(dataset, view.xKey);
  const withCategories = categoricalXPayload(base, data, view.xKey, xType);
  const split =
    groupCol !== null && groupCodes
      ? applyGroupSplit(
          withCategories,
          groupCodes,
          data.labels[groupCol] ?? `col ${groupCol}`,
          (code) => groupLevelLabel(data, groupCol, code),
          levelOrderFor(data, groupCol),
        )
      : withCategories;
  const display = composeDisplayPayload(split, {
    id: dataset.id,
    waterfall: view.waterfall,
    dropped: droppedRows(dataset),
    excludedDisplay: "hide",
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: null,
  });

  const styleList = display.series.map((_s, i) =>
    i < plotted.length ? view.seriesStyles[plotted[i]] : undefined,
  );
  const labelList = display.series.map((_s, i) =>
    i < plotted.length ? view.seriesLabels[plotted[i]] : undefined,
  );
  const hidden = display.series.map(
    (_s, i) => i < plotted.length && view.hiddenChannels.includes(plotted[i]),
  );
  // P1.5: a grouped render draws no error bars (usePlotPayload suppresses them).
  const spans: Map<number, ErrorSpan[]> =
    groupCol !== null ? new Map() : buildErrorSpans(data, plotted, figure.bindings.errors);

  const opts = buildOpts(display, {
    width: 800,
    height: 600,
    xScale: view.xScale,
    yScale: view.yScale,
    tool: "cursor",
    onReadout: () => {},
    xLim: view.xLim,
    yLim: view.yLim,
    y2Lim: view.y2Lim,
    y2Scale: view.y2Scale,
    xFmt: view.xFmt,
    yFmt: view.yFmt,
    y2Fmt: view.y2Fmt,
    xStep: view.xStep,
    yStep: view.yStep,
    y2Step: view.y2Step,
    showGrid: view.showGrid,
    axisBox: view.showAxisBox,
    title: view.plotTitle,
    xAxisLabel: view.xAxisLabel,
    yAxisLabel: view.yAxisLabel,
    y2AxisLabel: view.y2AxisLabel,
    seriesStyles: styleList,
    seriesLabels: labelList,
    hidden,
    plotted,
    errorSpans: spans,
    refLines: view.refLines,
    annotations: view.annotations,
    shapes: view.shapes,
    regionShades: view.regionShades,
    defaultTrace: "Line",
    steppedPaths: STEP_POST,
    steppedPathsPre: STEP_PRE,
    steppedPathsMid: STEP_MID,
  });

  return { mode, view, data, groupCol, plotted, split, display, styleList, spans, opts };
}

/** One entry per DRAWN display series, exactly as `buildOpts` resolved it and
 *  WITHOUT the group-mode collapse `projectScreen` applies — so a grouped
 *  figure reports its per-LEVEL strokes rather than one entry per channel.
 *  Read straight off the options object the canvas is constructed from; the
 *  BUG-016 divergence test is its only consumer. */
export function screenDrawnStyles(
  figure: FigureDocument,
  dataset: Dataset,
): { label: string; color: string; width: number | null; dash: number[] | null }[] {
  const { opts, plotted } = renderScreen(figure, dataset);
  return opts.series.slice(1, plotted.length + 1).map((s) => ({
    label: String(s.label ?? ""),
    color: String(s.stroke ?? ""),
    width: s.width ?? null,
    dash: s.dash ? [...s.dash] : null,
  }));
}

/** The x-ranges the SCREEN actually elides — MEASURED off the panel
 *  arrangement the Stage renders, not read back off the document. The
 *  arrangement comes from `lib/facet.durableComposition` — the SAME function
 *  (precedence included) `Stage/useEffectiveComposition`'s durable fallback
 *  derives the canvas's arrangement with, so this leg cannot claim a break the
 *  canvas would not draw. Each adjacent panel pair's `[previous panel's max
 *  x, next panel's min x]` IS the gap that arrangement leaves out. `[]` when nothing panels the
 *  x axis — an ordinary single-panel plot, or a facet grid, which shares one
 *  x domain and elides nothing (the same combination the export path
 *  resolves in favour of the facets). */
function screenXBreaks(figure: FigureDocument, dataset: Dataset, view: PlotView): [number, number][] {
  const composition = durableComposition(
    dataset, figure.bindings.facetKey, figure.plot.axisBreaks.x, view.xKey, view.yKeys,
  );
  const panels = breakPanelsOf(composition) ?? [];
  return panels.slice(1).map((p, i): [number, number] => [panels[i].xRange[1], p.xRange[0]]);
}

export function projectScreen(figure: FigureDocument, dataset: Dataset): CanonicalFigure {
  const { mode, view, data, groupCol, plotted, split, display, styleList, spans, opts } =
    renderScreen(figure, dataset);

  const drawn = opts.series.slice(1);
  const comparableStyle = styleComparable(mode);
  const series: CanonicalSeries[] = [];
  const errors: CanonicalFigure["errors"] = [];
  const allErrors = canonicalErrorsFromSpans(spans, plotted.length);
  const seen = new Set<number>();
  for (let p = 0; p < plotted.length; p++) {
    const ch = plotted[p];
    // GROUP mode: one canonical entry per BASE channel (see the header) —
    // every level of a channel carries that channel's one style.
    if (mode === "group" && seen.has(ch)) continue;
    seen.add(ch);
    const s = drawn[p] as uPlot.Series | undefined;
    if (!s || s.show === false) continue; // a hidden series is not drawn
    const style: SeriesStyle | undefined = styleList[p];
    const points = s.points as uPlot.Series.Points | undefined;
    const shownMarker = points?.show === true;
    series.push({
      channel: ch,
      // GROUP mode's canvas label carries the level suffix the backend
      // composes itself, so the CHANNEL label is what compares.
      label: mode === "group"
        ? (view.seriesLabels[ch] ?? displayLabel(data.labels, data.units, ch))
        : String(s.label ?? ""),
      unit: display.series[p]?.unit ?? "",
      axis: s.scale === "y2" ? 1 : 0,
      color: comparableStyle ? String(s.stroke ?? "") : null,
      width: comparableStyle ? (s.width ?? null) : null,
      dash: comparableStyle ? (s.dash ? [...s.dash] : null) : null,
      marker: comparableStyle && shownMarker
        ? { shape: markerDecision(style, "Line").shape, size: points?.size ?? 5 }
        : null,
      step: comparableStyle ? stepOf(s.paths) : null,
      fill: comparableStyle && s.fillTo === 0 ? "under" : null,
    });
    errors.push(allErrors[p] ?? []);
  }

  const y2Scale = opts.scales?.y2;
  return {
    mode,
    xBinding: view.xKey,
    series,
    errors,
    grouping: groupingOf(data, groupCol),
    facet: facetOf(data, figure.bindings.facetKey, view.xKey, view.yKeys),
    y2Positions: series.flatMap((s, i) => (s.axis === 1 ? [i] : [])),
    // BUG-012 (fixed): the screen's own paneled-break arrangement, measured
    // from the panel geometry it renders — see `screenXBreaks` above.
    xBreaks: screenXBreaks(figure, dataset, view),
    waterfallOffset: measureWaterfall(split, display),
    axes: {
      x: { label: axisLabelOf(opts.axes?.[0]?.label), scale: scaleOf(opts.scales?.x?.distr), limits: rangeOf(opts.scales?.x) },
      y: { label: axisLabelOf(opts.axes?.[1]?.label), scale: scaleOf(opts.scales?.y?.distr), limits: rangeOf(opts.scales?.y) },
      y2: y2Scale
        ? { label: axisLabelOf(opts.axes?.[2]?.label), scale: scaleOf(y2Scale.distr), limits: rangeOf(y2Scale) }
        : null,
    },
    // The decor arrays handed to `buildOpts` ARE the renderer's decor input —
    // the plugins that draw them close over these exact values.
    decor: decorOf(view),
  };
}

// ── export leg ──────────────────────────────────────────────────────────────

function fillWire(fill: "under" | { vs: number } | undefined): string | null {
  if (fill === "under") return "under";
  return fill && typeof fill === "object" ? `vs:${fill.vs}` : null;
}

export function projectExport(document: FigureDocument, dataset: Dataset): CanonicalFigure {
  return projectExportSpec(buildFigureSpecFromDocument(document, dataset, document.name), document);
}

/** Project an ALREADY-BUILT wire payload — so a page panel's embedded
 *  `PagePanelSpec.figure` is projected by the same code as a standalone
 *  export. `figure` supplies only the mode/binding identity the wire itself
 *  does not name (`facetKey`); it is named `figure` rather than `document`
 *  because `architecture.test.ts`'s F1 chokepoint guard reads a comma-preceded
 *  `document:` in any source module as a PlotWindow.document write. */
export function projectExportSpec(spec: FigureSpec, figure: FigureDocument): CanonicalFigure {
  const mode = figureMode(figure);
  const view = figureDocumentToPlotView(figure);
  const ds = spec.dataset;
  const plotted = (spec.y_keys ?? []) as number[];
  const y2 = new Set((spec.y2_keys ?? []) as number[]);
  const styles = spec.series_styles ?? [];
  const comparableStyle = styleComparable(mode);
  const overrides = spec.overrides ?? undefined;

  const series: CanonicalSeries[] = plotted.map((ch, i) => {
    const st = styles[i] ?? undefined;
    return {
      channel: ch,
      label: displayLabel(ds.labels, ds.units, ch),
      unit: ds.units[ch] ?? "",
      axis: y2.has(ch) ? 1 : 0,
      color: comparableStyle ? (st?.color ?? "") : null,
      width: comparableStyle ? (st?.width ?? null) : null,
      dash: comparableStyle ? dashOf(st?.line === "none" ? undefined : st?.line) : null,
      marker: comparableStyle && st?.marker
        ? { shape: st.marker_shape ?? "circle", size: st.marker_size ?? 5 }
        : null,
      step: comparableStyle ? (st?.step ?? null) : null,
      fill: comparableStyle ? fillWire(st?.fill) : null,
    };
  });

  const errors: CanonicalFigure["errors"] = plotted.map((_ch, i) => {
    const entry = spec.error_spans?.[i];
    if (!entry) return [];
    const out: CanonicalFigure["errors"][number] = [];
    for (const axis of ["y", "x"] as const) {
      const pair = entry[axis];
      if (!pair) continue;
      out.push({
        axis,
        plus: [...pair.plus],
        minus: [...pair.minus],
        symmetric: pair.plus.length === pair.minus.length && pair.plus.every((v, k) => v === pair.minus[k]),
      });
    }
    return out;
  });

  const legendLoc = overrides?.legend?.loc;
  const position =
    legendLoc === "upper right" ? "ne"
    : legendLoc === "upper left" ? "nw"
    : legendLoc === "lower right" ? "se"
    : legendLoc === "lower left" ? "sw"
    : null;

  return {
    mode,
    xBinding: spec.x_key === undefined ? null : (spec.x_key as number),
    series,
    errors,
    grouping: groupingOf(ds, spec.group_col ?? null),
    facet: facetOf(ds, figure.bindings.facetKey, view.xKey, view.yKeys, spec.facets ?? null),
    y2Positions: series.flatMap((s, i) => (s.axis === 1 ? [i] : [])),
    xBreaks: (overrides?.x_breaks ?? []).map((r) => [r[0], r[1]] as [number, number]),
    // BUG-013 (fixed): read straight off the WIRE FIELD — `waterfall_offsets`
    // carries the per-series stagger in Y data units, resolved by
    // `lib/waterfallOffset.ts`; `dataset.values` stay un-shifted on purpose.
    // Index 1 is the SECOND plotted series, which is what the screen leg's
    // `measureWaterfall` measures (`split`/`display` column 2). The two index
    // spaces coincide for every matrix fixture (none hides a series AND sets a
    // waterfall); a fixture that did both would compare the second PLOTTED
    // series here against the second DISPLAYED one there.
    waterfallOffset: spec.waterfall_offsets?.[1] ?? 0,
    axes: {
      x: { label: spec.x_label ?? null, scale: spec.x_scale ?? "linear", limits: limitsOf(overrides?.x_lim as [number, number] | undefined) },
      y: { label: spec.y_label ?? null, scale: spec.y_scale ?? "linear", limits: limitsOf(overrides?.y_lim as [number, number] | undefined) },
      y2: (spec.y2_keys?.length ?? 0) > 0
        ? {
            label: spec.y2_label ?? null,
            scale: spec.y2_scale ?? spec.y_scale ?? "linear",
            limits: limitsOf(overrides?.y2_lim as [number, number] | undefined),
          }
        : null,
    },
    decor: {
      legend: {
        show: overrides?.legend?.show ?? false,
        position: overrides?.legend?.show ? position : null,
        title: overrides?.legend?.title ?? null,
      },
      annotations: (overrides?.annotations ?? []).map((a) => ({ x: a.x, y: a.y, text: a.text })),
      shapes: (overrides?.shapes ?? []).map((s) => ({ kind: s.kind, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })),
      refLines: (overrides?.ref_lines ?? []).map((r) => ({ axis: r.axis, value: r.value })),
      regionShades: (overrides?.region_shades ?? []).map((r) => ({
        x1: r.x1, x2: r.x2, y1: r.y1, y2: r.y2, fill: r.fill,
      })),
    },
  };
}
