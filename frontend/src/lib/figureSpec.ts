// The ONE builder that turns the live on-screen plot state into a backend
// FigureSpec — extracted from exportFigureCommand.ts (MAIN_PLAN #35) so that
// "Export figure…" and "Copy figure" render through the SAME publication path
// instead of drifting apart.
//
// That shared path is the whole point of #35. Copy previously composited the
// uPlot canvas at screen resolution, so a pasted figure and an exported one
// disagreed on fonts, line widths, tick formats, limits, legend placement and
// multi-panel layout. Both now build this spec and post it to
// /api/export/figure; only the output verb differs (download vs clipboard).
// Do NOT add a third rendering implementation — extend this one.

import {
  resolveSecondaryAxis,
  secondaryAxisFromView,
  secondaryAxisIsLog,
  secondaryAxisWire,
} from "./axisspec";
import type { ErrorPair, FigureSpec } from "./api";
import { buildErrorSpans } from "./errorbars";
import { buildExportStyles } from "./exportStyles";
import type { StoreGet } from "./exportActive";
import { figureDocumentToPlotView, type FigureDocument } from "./figureDocument";
import {
  compactOverrides,
  gateY2Overrides,
  legendPosToLoc,
  mergeFigureOverrides,
  type FigureOverrides,
} from "./figureOverrides";
import { marginFractions, pageSizeInches } from "./pagesetup";
import { effectiveChannels } from "./plotdata";
import type { PlotView } from "./plotview";
import type { ErrorBinding } from "./errorRoles";
import type { Dataset, DataStruct } from "./types";
import { axisFmtParam } from "./types";

/** The render-time choices a caller supplies. Everything else about the spec
 *  is derived from live view state, so the two callers cannot diverge on it. */
export interface FigureRenderOpts {
  fmt: string;
  style: string;
  dpi: number;
  title: string;
  /** Blank/undefined = derive the label from the data column. */
  xLabel?: string;
  yLabel?: string;
}

/** Optional publication choices layered over a FigureDocument's saved output
 * settings. Labels and title default to the document's PlotView; `filename`
 * defaults to the document output filename, then the caller's export stem. */
export interface FigureDocumentRenderOpts extends Partial<FigureRenderOpts> {
  transparent?: boolean;
  filename?: string | null;
}

/** Resolve the data that a canonical document is allowed to render. A frozen
 * document is self-contained and intentionally ignores any live dataset. A
 * live document must name, and be given, its exact bound dataset: accepting a
 * different one would silently export the right styling against wrong data. */
export function resolveFigureDocumentData(
  document: FigureDocument,
  dataset?: Dataset | null,
): { data: DataStruct; channelRoles?: Dataset["channelRoles"] } {
  if (document.data.mode === "frozen") {
    if (!document.data.snapshot) throw new Error("frozen figure document has no data snapshot");
    return { data: structuredClone(document.data.snapshot) };
  }
  if (document.bindings.datasetId === null) throw new Error("live figure document has no dataset binding");
  if (!dataset) throw new Error(`live figure document requires dataset "${document.bindings.datasetId}"`);
  if (dataset.id !== document.bindings.datasetId) {
    throw new Error(`figure document is bound to dataset "${document.bindings.datasetId}", not "${dataset.id}"`);
  }
  return { data: dataset.data, channelRoles: dataset.channelRoles };
}

/** Build the figure request for `ds` as it is currently displayed.
 *
 *  Throws when nothing is visible — callers surface that as an ordinary
 *  export/copy failure rather than posting an empty figure. */
export function buildFigureSpec(
  s: StoreGet,
  ds: Dataset,
  stem: string,
  o: FigureRenderOpts,
): FigureSpec {
  const st = s();
  return buildFigureSpecForView(st, ds.data, ds.channelRoles, ds.errorRoles, stem, o);
}

/** Build the common export transport from a complete PlotView projection. The
 * legacy StoreGet entry point and the FigureDocument entry point both route
 * here, so export parity does not depend on duplicated field-by-field maps. */
function buildFigureSpecForView(
  st: PlotView,
  data: DataStruct,
  channelRoles: Dataset["channelRoles"] | undefined,
  errors: readonly ErrorBinding[] | undefined,
  stem: string,
  o: FigureRenderOpts,
  extras: {
    groupKey?: number | null;
    xBreaks?: readonly [number, number][];
    transparent?: boolean;
    filename?: string | null;
    publicationOverrides?: FigureOverrides | null;
    /** `undefined` derives from the canonical PlotView; `null` omits styles. */
    publicationSeriesStyles?: FigureSpec["series_styles"] | null;
    /** Preserve the valid canonical case where an explicitly selected channel
     * is deliberately used for both X and Y. */
    allowExplicitXAsY?: boolean;
  } = {},
): FigureSpec {
  // #54 Stage 3: honor the window's page — figsize (inches) + margins. Absent
  // pageSetup keeps the preset size + tight_layout behaviour.
  const ps = st.pageSetup;
  const pageSize = ps ? pageSizeInches(ps) : null;
  const overrides = ps
    ? (compactOverrides({
        ...(viewOverrides(st) ?? {}),
        margins: marginFractions(ps),
      }) ?? undefined)
    : viewOverrides(st);
  const withBreaks = extras.xBreaks?.length
    ? (compactOverrides({ ...overrides, x_breaks: extras.xBreaks.map((range) => [...range] as [number, number]) }) ?? undefined)
    : overrides;

  // Match the DISPLAY order, not the raw yKeys: seriesOrder and hidden legend
  // entries are both visible-state decisions. Multi-X Origin books also
  // require the live xKey instead of silently falling back to time.
  const plotted = effectiveChannels(
    data,
    st.yKeys,
    extras.allowExplicitXAsY && st.yKeys !== null ? null : st.xKey,
    channelRoles,
    st.seriesOrder,
  ).filter((ch) => !st.hiddenChannels.includes(ch));
  if (plotted.length === 0) throw new Error("no visible series to export");

  // Legend renames / decoded Origin captions are channel-keyed. Apply them to
  // a request-local DataStruct label copy so the backend series builder and
  // legend path both see the same display names without mutating the imported
  // workbook.
  const dataset = Object.keys(st.seriesLabels).length
    ? {
        ...data,
        labels: data.labels.map((label, ch) => st.seriesLabels[ch] ?? label),
      }
    : data;

  // Secondary (right) Y axis (matplotlib twinx): y2Keys tags a SUBSET of
  // `plotted` — send y_keys = the FULL plotted list (the backend's y2_keys is a
  // subset marker, not a replacement), plus that subset in display order, so
  // the render shows the same dual-Y split the screen does. The split + the
  // scale/format inherit rules live in lib/axisspec.ts (#54 pass B).
  const y2Axis = resolveSecondaryAxis(plotted, secondaryAxisFromView(st), {
    scale: st.yScale,
    fmt: st.yFmt,
  });
  // The renderer deliberately has no grouped-secondary-axis semantic: group
  // expansion produces synthetic primary-axis series, so the backend rejects
  // this combination. Fail before transport rather than silently dropping a
  // canonical binding or sending a request guaranteed to receive a 422.
  if (extras.groupKey !== null && extras.groupKey !== undefined && y2Axis !== null) {
    throw new Error("grouped figures cannot use a secondary Y axis");
  }
  // `overrides` was built before this function learned the plotted/y2 split —
  // gate the two fields that depend on it (a stale y2_lim; a log-scaled
  // secondary axis's minor ticks) now that the split is known.
  const publicationOverrides = mergeFigureOverrides(withBreaks, extras.publicationOverrides);
  const gatedOverrides = gateY2Overrides(publicationOverrides, {
    y2Plotted: y2Axis !== null,
    minorTicks: st.xScale === "log" || st.yScale === "log" || secondaryAxisIsLog(y2Axis),
  });

  return {
    dataset,
    x_key: st.xKey ?? undefined,
    y_keys: plotted,
    x_scale: st.xScale,
    y_scale: st.yScale,
    x_fmt: axisFmtParam(st.xFmt),
    y_fmt: axisFmtParam(st.yFmt),
    x_step: st.xStep,
    y_step: st.yStep,
    // y2Fmt/y2Scale null inherit yFmt/yScale on screen — `resolveSecondaryAxis`
    // applied that same inherit-default above, so the render matches the live
    // plot without this call site restating the rule.
    ...secondaryAxisWire(y2Axis),
    ...(extras.groupKey === null || extras.groupKey === undefined ? {} : { group_col: extras.groupKey }),
    fmt: o.fmt,
    style: o.style,
    dpi: o.dpi,
    width_in: pageSize?.width_in,
    height_in: pageSize?.height_in,
    title: o.title,
    x_label: o.xLabel || undefined,
    y_label: o.yLabel || undefined,
    ...(extras.publicationSeriesStyles === undefined
      ? { series_styles: buildExportStyles(plotted, st.seriesStyles) }
      : extras.publicationSeriesStyles === null
        ? {}
        : { series_styles: structuredClone(extras.publicationSeriesStyles) }),
    // MAIN #36: the SAME spans the canvas draws, so a PDF cannot quietly
    // understate the uncertainty the screen showed.
    ...(errors?.length
      ? { error_spans: exportErrorSpans(data, plotted, errors) }
      : {}),
    overrides: gatedOverrides,
    ...(extras.transparent === undefined ? {} : { transparent: extras.transparent }),
    filename: extras.filename ?? stem,
  };
}

/** Derive an export request directly from the canonical document. Frozen
 * documents render their immutable data snapshot; live documents reject a
 * missing or mismatched dataset instead of exporting an accidental sibling.
 * FigureSpec has no transport fields for `mark`, `facetKey`, or Y/Y2 breaks;
 * those remain intact in the FigureDocument and are never flattened/deleted by
 * this adapter. X breaks do have a renderer field and are emitted. */
export function buildFigureSpecFromDocument(
  document: FigureDocument,
  dataset: Dataset | null | undefined,
  stem: string,
  overrides: FigureDocumentRenderOpts = {},
): FigureSpec {
  const resolved = resolveFigureDocumentData(document, dataset);
  const view = figureDocumentToPlotView(document);
  // `null` is an explicit "use this export's stem" override; only omitted
  // (`undefined`) inherits the saved document filename.
  const filename = overrides.filename === undefined ? document.output.filename : overrides.filename;
  return buildFigureSpecForView(
    view,
    resolved.data,
    resolved.channelRoles,
    document.bindings.errors,
    stem,
    {
      fmt: overrides.fmt ?? document.output.format,
      style: overrides.style ?? document.output.stylePreset,
      dpi: overrides.dpi ?? document.output.dpi,
      title: overrides.title ?? view.plotTitle,
      xLabel: overrides.xLabel ?? view.xAxisLabel,
      yLabel: overrides.yLabel ?? view.yAxisLabel,
    },
    {
      groupKey: document.bindings.groupKey,
      xBreaks: document.plot.axisBreaks.x,
      transparent: overrides.transparent ?? document.output.transparent,
      filename,
      publicationOverrides: document.publication?.overrides,
      publicationSeriesStyles: document.publication?.seriesStyles,
      allowExplicitXAsY: true,
    },
  );
}

/** Screen-parity overrides (MAIN #18): annotations (with their pointer-tool
 *  `size` override) + the legend's screen position — free `legendXY`
 *  (fractions) maps to matplotlib's `loc: "custom"` + `anchor`
 *  (`calc.figure_overrides`' pre-existing #14 drag-to-place handling); a
 *  corner `legendPos` maps through `legendPosToLoc`. A page-anchored
 *  annotation (MAIN #21) carries `anchor: "page"` through so the backend
 *  renders it as figure-fraction placement instead of axes-data coords —
 *  see `calc.figure_overrides._apply_overrides`'s y-flip. MAIN #27 adds
 *  `shapes` (drawn arrow/line/rect/ellipse marks) and an annotation's
 *  `frame` ("text box") — see `calc.figure_shapes._apply_shapes`.
 *  The same override carries live finite x/y limits, grid, axis-box spines,
 *  and log minor-tick state through fields the backend already supports.
 *  A live secondary-axis range (`y2Lim`) rides `y2_lim` through this SAME
 *  override mechanism (only meaningful alongside a request that also sets
 *  `y2_keys`); error-bar/region/ref-line concepts remain unsupported here. */
export function viewOverrides(st: Pick<
  PlotView,
  | "legendTitle"
  | "showLegend"
  | "legendFrameXY"
  | "legendXY"
  | "legendPos"
  | "annotations"
  | "shapes"
  | "xLim"
  | "yLim"
  | "y2Lim"
  | "showGrid"
  | "showAxisBox"
  | "xScale"
  | "yScale"
>): FigureOverrides | undefined {
  // Decode #52: the legend title (Origin's bold header) rides the legend
  // override so vector export matches the screen's static legend.
  const legendTitle = st.legendTitle ? { title: st.legendTitle } : {};
  // Precedence matches the screen (decode #52): a frame anchor (`legendFrameXY`,
  // an AXES fraction — `loc: "axes"`, exact via ax.transAxes) beats a free
  // container fraction (`legendXY` → figure-fraction `loc: "custom"`, MAIN #14),
  // which beats the corner preset.
  const legend: FigureOverrides["legend"] = st.showLegend
    ? st.legendFrameXY
      ? { show: true, loc: "axes", anchor: st.legendFrameXY, ...legendTitle }
      : st.legendXY
        ? { show: true, loc: "custom", anchor: st.legendXY, ...legendTitle }
        : { show: true, loc: legendPosToLoc(st.legendPos), ...legendTitle }
    : { show: false };
  const annotations = st.annotations
    .filter((a) => Number.isFinite(a.x) && Number.isFinite(a.y))
    .map((a) => ({
      x: a.x,
      y: a.y,
      text: a.text,
      ...(a.size ? { size: a.size } : {}),
      ...(a.anchor === "page" ? { anchor: "page" as const } : {}),
      ...(a.frame ? { frame: a.frame } : {}),
    }));
  // MAIN #27: drawn shapes, wire-shaped (no `id` — the render request needs no
  // identity, unlike the screen's editable list).
  const shapes = st.shapes
    .filter((s) => [s.x1, s.y1, s.x2, s.y2].every(Number.isFinite))
    .map((s) => ({
      kind: s.kind,
      x1: s.x1,
      y1: s.y1,
      x2: s.x2,
      y2: s.y2,
      ...(s.anchor === "page" ? { anchor: "page" as const } : {}),
      ...(s.stroke ? { stroke: s.stroke } : {}),
      ...(s.fill ? { fill: s.fill } : {}),
      ...(s.opacity != null ? { opacity: s.opacity } : {}),
      ...(s.width != null ? { width: s.width } : {}),
      ...(s.dash ? { dash: s.dash } : {}),
    }));
  const finiteLim = (lim: [number, number] | null): [number, number] | undefined =>
    lim && lim.every(Number.isFinite) ? lim : undefined;
  return (
    compactOverrides({
      legend,
      annotations,
      shapes,
      x_lim: finiteLim(st.xLim),
      y_lim: finiteLim(st.yLim),
      y2_lim: finiteLim(st.y2Lim),
      grid: st.showGrid,
      spines: { top: st.showAxisBox, right: st.showAxisBox },
      ticks: st.xScale === "log" || st.yScale === "log" ? { minor: true } : undefined,
    }) ?? undefined
  );
}

/** Store facade retained for existing callers and tests. */
export function liveViewOverrides(s: StoreGet): FigureOverrides | undefined {
  return viewOverrides(s());
}

/** Project the canvas error spans onto the export wire shape.
 *
 *  `buildErrorSpans` keys by uPlot COLUMN (0 = x, p+1 = the p-th series); the
 *  renderer wants one entry per plotted SERIES, so this re-indexes rather than
 *  letting the two conventions meet in the route — where the off-by-one would
 *  show up as error bars on the wrong curve. */
export function exportErrorSpans(
  data: DataStruct,
  plotted: number[],
  roles: readonly ErrorBinding[],
): ({ x?: ErrorPair; y?: ErrorPair } | null)[] {
  const byCol = buildErrorSpans(data, plotted, roles);
  return plotted.map((_ch, p) => {
    const spans = byCol.get(p + 1);
    if (!spans?.length) return null;
    const out: { x?: ErrorPair; y?: ErrorPair } = {};
    for (const s of spans) out[s.axis] = { plus: s.plus, minus: s.minus };
    return out;
  });
}
