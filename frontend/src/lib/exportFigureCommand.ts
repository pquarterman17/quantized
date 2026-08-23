// The "Export figure…" File command body — extracted from appCommands.ts
// (MAIN_PLAN #16, Append workspace) under that file's own store-size
// ratchet (architecture.test.ts's STORE_PINS): a couple of lines were
// needed for the new "Append workspace (.dwk)…" command, and this was the
// largest self-contained, no-JSX command body available to offset them.
// Pure orchestration: prompts for format/style/dpi/labels, then calls the
// export API against the active dataset — no React/store coupling beyond
// the `StoreGet` handle every command closure already takes.
//
// The spec itself is built by `lib/figureSpec.buildStageFigureSpec` (MAIN_PLAN
// #35; routed through the canonical-document adapter as of F2.5b), shared
// verbatim with "Copy figure" so a pasted figure and an exported one cannot
// drift. This file now owns only the DIALOG and the download verb.

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigure } from "./api/figures";
import { exportActive, type StoreGet } from "./exportActive";
import { buildStageFigureSpec } from "./figureSpec";

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
  // Guarded (not a bare `as string`): coerceParams now guarantees every field
  // key is present, but this stays defensive — a `.trim()` on a genuinely
  // missing/non-string value must never throw. A throw HERE (building the
  // buildFigureSpec argument) is still inside exportActive's try/catch, but
  // it would abort the export having ALREADY closed the dialog, with no
  // visible feedback beyond a status/toast — never a silent hang, but still
  // worth never triggering (P0.4 finding 15, 2026-07-27 — see
  // ParamDialog.tsx's header comment for the render race that used to make
  // an EARLIER version of this exact pattern throw OUTSIDE exportActive
  // entirely, silently, before exportActive ever ran).
  const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
  const xl = asStr(params.x_label).trim();
  const yl = asStr(params.y_label).trim();
  const titleStr = asStr(params.title).trim();
  await exportActive(s, (stem, ds) =>
    exportFigure(
      buildStageFigureSpec(s, ds, stem, {
        fmt: params.fmt as string,
        style: params.style as string,
        dpi: params.dpi as number,
        title: titleStr,
        xLabel: xl,
        yLabel: yl,
      }),
    ),
  );
}
