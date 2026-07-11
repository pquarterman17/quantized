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
    { key: "title", label: "Title", type: "text", default: "" },
    {
      key: "x_label",
      label: "X label",
      type: "text",
      default: "",
      hint: "Blank = derive from the data column",
    },
    { key: "y_label", label: "Y label", type: "text", default: "" },
  ]);
  if (!params) return;
  // Blank label fields mean "derive from the data" → send undefined, not "".
  const xl = (params.x_label as string).trim();
  const yl = (params.y_label as string).trim();
  exportActive(s, (stem, ds) => {
    // Per-series styles in plotted order so the figure matches the screen.
    const plotted = s().yKeys ?? ds.data.labels.map((_, i) => i);
    return exportFigure({
      dataset: ds.data,
      y_keys: s().yKeys ?? undefined,
      x_scale: s().xScale,
      y_scale: s().yScale,
      fmt: params.fmt as string,
      style: params.style as string,
      dpi: params.dpi as number,
      title: (params.title as string).trim(),
      x_label: xl || undefined,
      y_label: yl || undefined,
      series_styles: buildExportStyles(plotted, s().seriesStyles),
      overrides: liveViewOverrides(s),
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
 *  see `calc.figure_overrides._apply_overrides`'s y-flip. Everything else
 *  this command already sends (title/labels/scales/styles) — this only
 *  adds the screen-state pieces that had no export path before. */
export function liveViewOverrides(s: StoreGet): FigureOverrides | undefined {
  const st = s();
  const legend: FigureOverrides["legend"] = st.showLegend
    ? st.legendXY
      ? { show: true, loc: "custom", anchor: st.legendXY }
      : { show: true, loc: legendPosToLoc(st.legendPos) }
    : { show: false };
  const annotations = st.annotations
    .filter((a) => Number.isFinite(a.x) && Number.isFinite(a.y))
    .map((a) => ({
      x: a.x,
      y: a.y,
      text: a.text,
      ...(a.size ? { size: a.size } : {}),
      ...(a.anchor === "page" ? { anchor: "page" as const } : {}),
    }));
  return compactOverrides({ legend, annotations }) ?? undefined;
}
