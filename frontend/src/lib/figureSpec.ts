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
import {
  compactOverrides,
  gateY2Overrides,
  legendPosToLoc,
  type FigureOverrides,
} from "./figureOverrides";
import { marginFractions, pageSizeInches } from "./pagesetup";
import { effectiveChannels } from "./plotdata";
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
  // #54 Stage 3: honor the window's page — figsize (inches) + margins. Absent
  // pageSetup keeps the preset size + tight_layout behaviour.
  const ps = st.pageSetup;
  const pageSize = ps ? pageSizeInches(ps) : null;
  const overrides = ps
    ? (compactOverrides({
        ...(liveViewOverrides(s) ?? {}),
        margins: marginFractions(ps),
      }) ?? undefined)
    : liveViewOverrides(s);

  // Match the DISPLAY order, not the raw yKeys: seriesOrder and hidden legend
  // entries are both visible-state decisions. Multi-X Origin books also
  // require the live xKey instead of silently falling back to time.
  const plotted = effectiveChannels(
    ds.data,
    st.yKeys,
    st.xKey,
    ds.channelRoles,
    st.seriesOrder,
  ).filter((ch) => !st.hiddenChannels.includes(ch));
  if (plotted.length === 0) throw new Error("no visible series to export");

  // Legend renames / decoded Origin captions are channel-keyed. Apply them to
  // a request-local DataStruct label copy so the backend series builder and
  // legend path both see the same display names without mutating the imported
  // workbook.
  const dataset = Object.keys(st.seriesLabels).length
    ? {
        ...ds.data,
        labels: ds.data.labels.map((label, ch) => st.seriesLabels[ch] ?? label),
      }
    : ds.data;

  // Secondary (right) Y axis (matplotlib twinx): y2Keys tags a SUBSET of
  // `plotted` — send y_keys = the FULL plotted list (the backend's y2_keys is a
  // subset marker, not a replacement), plus that subset in display order, so
  // the render shows the same dual-Y split the screen does. The split + the
  // scale/format inherit rules live in lib/axisspec.ts (#54 pass B).
  const y2Axis = resolveSecondaryAxis(plotted, secondaryAxisFromView(st), {
    scale: st.yScale,
    fmt: st.yFmt,
  });
  // `overrides` was built before this function learned the plotted/y2 split —
  // gate the two fields that depend on it (a stale y2_lim; a log-scaled
  // secondary axis's minor ticks) now that the split is known.
  const gatedOverrides = gateY2Overrides(overrides, {
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
    fmt: o.fmt,
    style: o.style,
    dpi: o.dpi,
    width_in: pageSize?.width_in,
    height_in: pageSize?.height_in,
    title: o.title,
    x_label: o.xLabel || undefined,
    y_label: o.yLabel || undefined,
    series_styles: buildExportStyles(plotted, st.seriesStyles),
    // MAIN #36: the SAME spans the canvas draws, so a PDF cannot quietly
    // understate the uncertainty the screen showed.
    ...(ds.errorRoles?.length
      ? { error_spans: exportErrorSpans(ds.data, plotted, ds.errorRoles) }
      : {}),
    overrides: gatedOverrides,
    filename: stem,
  };
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
export function liveViewOverrides(s: StoreGet): FigureOverrides | undefined {
  const st = s();
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

/** Project the canvas error spans onto the export wire shape.
 *
 *  `buildErrorSpans` keys by uPlot COLUMN (0 = x, p+1 = the p-th series); the
 *  renderer wants one entry per plotted SERIES, so this re-indexes rather than
 *  letting the two conventions meet in the route — where the off-by-one would
 *  show up as error bars on the wrong curve. */
export function exportErrorSpans(
  data: DataStruct,
  plotted: number[],
  roles: ErrorBinding[],
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
