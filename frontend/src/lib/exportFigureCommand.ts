// The "Export figure…" File command body — extracted from appCommands.ts
// (MAIN_PLAN #16, Append workspace) under that file's own store-size
// ratchet (architecture.test.ts's STORE_PINS): a couple of lines were
// needed for the new "Append workspace (.dwk)…" command, and this was the
// largest self-contained, no-JSX command body available to offset them.
// Pure orchestration: prompts for format/style/dpi/labels, then calls the
// export API against the active dataset — no React/store coupling beyond
// the `StoreGet` handle every command closure already takes.

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigure } from "./api";
import { buildExportStyles } from "./exportStyles";
import { exportActive, type StoreGet } from "./exportActive";
import { compactOverrides, legendPosToLoc, type FigureOverrides } from "./figureOverrides";
import { marginFractions, pageSizeInches } from "./pagesetup";
import { effectiveChannels } from "./plotdata";
import { axisFmtParam } from "./types";

export async function runExportFigureCommand(s: StoreGet): Promise<void> {
  const params = await askParams("Export figure", [
    {
      key: "fmt",
      label: "Format",
      type: "select",
      default: "pdf",
      options: ["pdf", "svg", "png", "tiff"],
      hint: "PDF / SVG are vector; PNG / TIFF are raster",
    },
    {
      key: "style",
      label: "Style",
      type: "select",
      default: "default",
      options: ["default", "aps", "nature", "thesis", "report", "web", "presentation", "poster"],
      hint: "Publication preset: sets font, size, line width, grid",
    },
    {
      key: "dpi",
      label: "DPI (raster)",
      type: "number",
      default: 300,
      hint: "Resolution for PNG / TIFF (50–1200); ignored by vector",
    },
    { key: "title", label: "Title", type: "text", default: s().plotTitle },
    {
      key: "x_label",
      label: "X label",
      type: "text",
      default: s().xAxisLabel,
      hint: "Blank = derive from the data column",
    },
    { key: "y_label", label: "Y label", type: "text", default: s().yAxisLabel },
  ]);
  if (!params) return;
  // Blank label fields mean "derive from the data" → send undefined, not "".
  const xl = (params.x_label as string).trim();
  const yl = (params.y_label as string).trim();
  // #54 Stage 3: honor the window's page — figsize (inches) + margins. Absent
  // pageSetup keeps today's behaviour (preset size, tight_layout).
  const ps = s().pageSetup;
  const pageSize = ps ? pageSizeInches(ps) : null;
  const overrides = ps
    ? compactOverrides({ ...(liveViewOverrides(s) ?? {}), margins: marginFractions(ps) }) ?? undefined
    : liveViewOverrides(s);
  exportActive(s, (stem, ds) => {
    const st = s();
    // Match the DISPLAY order, not the raw yKeys: seriesOrder and hidden
    // legend entries are both visible-state decisions. Multi-X Origin books
    // also require the live xKey instead of silently falling back to time.
    const plotted = effectiveChannels(
      ds.data,
      st.yKeys,
      st.xKey,
      ds.channelRoles,
      st.seriesOrder,
    ).filter((ch) => !st.hiddenChannels.includes(ch));
    if (plotted.length === 0) throw new Error("no visible series to export");
    // Legend renames / decoded Origin captions are channel-keyed. Apply them
    // to a request-local DataStruct label copy so the established backend
    // series builder and legend path both see the same display names without
    // mutating the imported workbook.
    const dataset = Object.keys(st.seriesLabels).length
      ? {
          ...ds.data,
          labels: ds.data.labels.map((label, ch) => st.seriesLabels[ch] ?? label),
        }
      : ds.data;
    // Secondary (right) Y axis (matplotlib twinx): y2Keys tags a SUBSET of
    // `plotted` — send y_keys = the FULL plotted list exactly as today (the
    // backend's y2_keys is a subset marker, not a replacement), plus that
    // subset in display order, so the export renders the same dual-Y split
    // the screen already shows instead of flattening it onto one axis.
    const y2Set = new Set(st.y2Keys ?? []);
    const y2Plotted = plotted.filter((ch) => y2Set.has(ch));
    const y2l = st.y2AxisLabel.trim();
    return exportFigure({
      dataset,
      x_key: st.xKey ?? undefined,
      y_keys: plotted,
      x_scale: st.xScale,
      y_scale: st.yScale,
      x_fmt: axisFmtParam(st.xFmt),
      y_fmt: axisFmtParam(st.yFmt),
      x_step: st.xStep,
      y_step: st.yStep,
      ...(y2Plotted.length
        ? {
            y2_keys: y2Plotted,
            y2_label: y2l || undefined,
            y2_scale: st.y2Scale ?? st.yScale,
            y2_step: st.y2Step,
          }
        : {}),
      fmt: params.fmt as string,
      style: params.style as string,
      dpi: params.dpi as number,
      width_in: pageSize?.width_in,
      height_in: pageSize?.height_in,
      title: (params.title as string).trim(),
      x_label: xl || undefined,
      y_label: yl || undefined,
      series_styles: buildExportStyles(plotted, st.seriesStyles),
      overrides,
      filename: stem,
    });
  });
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
 *  override mechanism (only meaningful alongside `runExportFigureCommand`'s
 *  own `y2_keys`); error-bar/region/ref-line concepts remain unsupported
 *  here. */
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
  // MAIN #27: drawn shapes, wire-shaped (no `id` — the export request needs
  // no identity, unlike the screen's editable list).
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
  return compactOverrides({
    legend,
    annotations,
    shapes,
    x_lim: finiteLim(st.xLim),
    y_lim: finiteLim(st.yLim),
    y2_lim: finiteLim(st.y2Lim),
    grid: st.showGrid,
    spines: { top: st.showAxisBox, right: st.showAxisBox },
    ticks: st.xScale === "log" || st.yScale === "log" ? { minor: true } : undefined,
  }) ?? undefined;
}
