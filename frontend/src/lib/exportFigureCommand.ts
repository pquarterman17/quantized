// The "Export figure…" File command body — extracted from appCommands.ts
// (MAIN_PLAN #16, Append workspace) under that file's own store-size
// ratchet (architecture.test.ts's STORE_PINS): a couple of lines were
// needed for the new "Append workspace (.dwk)…" command, and this was the
// largest self-contained, no-JSX command body available to offset them.
// Pure orchestration: prompts for format/style/dpi/labels, then calls the
// export API against the active dataset — no React/store coupling beyond
// the `StoreGet` handle every command closure already takes.
//
// The spec itself is built by `lib/figureSpec.buildFigureSpec` (MAIN_PLAN
// #35), shared verbatim with "Copy figure" so a pasted figure and an exported
// one cannot drift. This file now owns only the DIALOG and the download verb.

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigure } from "./api";
import { exportActive, type StoreGet } from "./exportActive";
import { buildFigureSpec } from "./figureSpec";

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
  await exportActive(s, (stem, ds) =>
    exportFigure(
      buildFigureSpec(s, ds, stem, {
        fmt: params.fmt as string,
        style: params.style as string,
        dpi: params.dpi as number,
        title: (params.title as string).trim(),
        xLabel: xl,
        yLabel: yl,
      }),
    ),
  );
}
