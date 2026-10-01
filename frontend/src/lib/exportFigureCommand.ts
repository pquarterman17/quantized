// The "Export figure…" File command body — extracted from appCommands.ts
// (MAIN_PLAN #16, Append workspace) under that file's own store-size
// ratchet (architecture.test.ts's STORE_PINS): a couple of lines were
// needed for the new "Append workspace (.dwk)…" command, and this was the
// largest self-contained, no-JSX command body available to offset them.
// Pure orchestration: prompts for format/style/dpi/greyscale/labels, then
// calls the export API against the active dataset — no React/store coupling
// beyond the `StoreGet` handle every command closure already takes.
//
// The spec itself is built by `lib/figureSpecStage.buildStageFigureSpec` (MAIN_PLAN
// #35; routed through the canonical-document adapter as of F2.5b), shared
// verbatim with "Copy figure" so a pasted figure and an exported one cannot
// drift. This file now owns only the DIALOG and the download verb.

import { askParams, type ParamField } from "../components/overlays/ParamDialog";
import { exportFigure } from "./api/figures";
import { exportActive, type StoreGet } from "./exportActive";
import type { FigureSpec } from "./api/figures";
import type { FigureRenderOpts } from "./figureSpec";
import { buildStageFigureSpec } from "./figureSpecStage";
import { chooseExcludedRows } from "./excludedRowsChoice";
import { excludedChoiceMatters } from "./excludedRowsExport";
import { confirmScreenOnlyExport } from "./screenOnlyExport";
import { exportStatFigure } from "./statFigureCommands";
import { activeStatExporter } from "./statStageBridge";
import type { Dataset } from "./types";
import { toast } from "../store/toasts";

/** PRIMARY_SOFTWARE_AUDIT_PLAN P3.3's "Greyscale (print-safe)" checkbox — the
 *  Export-figure dialog's own first boolean field. Exported so every OTHER
 *  export dialog that embeds a `FigureSpec` (lib/exportPageCommand.ts's page
 *  export) reuses this exact field instead of duplicating the label/hint text
 *  and risking the two drifting apart. */
export const GREYSCALE_FIELD: ParamField = {
  key: "greyscale",
  label: "Greyscale (print-safe)",
  type: "boolean",
  default: false,
  hint: "Export only — the on-screen plot stays coloured; forces a grey ramp plus dash/marker cycling",
};

/** The publication style presets the dialog offers — exported so "Send
 *  figure to report…" (lib/sendFigureToReport.ts) offers the SAME list. */
export const FIGURE_STYLES = ["default", "aps", "nature", "thesis", "report", "web", "presentation", "poster"];

/** Format, style and DPI — the dialog's first three fields, and all a stat
 *  plot's export takes (its titles come from the stage). */
const OUTPUT_FIELDS: ParamField[] = [
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
    options: FIGURE_STYLES,
    hint: "Publication preset: sets font, size, line width, grid",
  },
  {
    key: "dpi",
    label: "DPI (raster)",
    type: "number",
    default: 300,
    hint: "Resolution for PNG / TIFF (50–1200); ignored by vector",
  },
];

/** `buildSpec` replaces the focused Stage plot as the figure's source while
 *  keeping this dialog and `exportActive`'s chokepoint — the Graph Builder's
 *  encoded export (`lib/plotEncodingExport.ts`) is its one caller. */
export async function runExportFigureCommand(
  s: StoreGet,
  buildSpec?: (stem: string, ds: Dataset, o: FigureRenderOpts) => FigureSpec,
): Promise<void> {
  // Refuse before the dialog: `exportActive` would refuse anyway, but only
  // after every field below had been answered.
  if (!s().datasets.some((d) => d.id === s().activeId)) {
    const msg = "Nothing to export: import or select a dataset first.";
    s().setStatus(msg);
    toast(msg, "info");
    return;
  }
  // Stat mode exports the stat plot on screen through the stage's own export.
  const stat = buildSpec ? null : activeStatExporter(s());
  if (stat) {
    const p = await askParams("Export figure", OUTPUT_FIELDS);
    if (p) await exportStatFigure(s, stat, String(p.fmt), { style: String(p.style), dpi: Number(p.dpi) });
    return;
  }
  const params = await askParams("Export figure", [
    ...OUTPUT_FIELDS,
    GREYSCALE_FIELD,
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
  const opts: FigureRenderOpts = {
    fmt: params.fmt as string,
    style: params.style as string,
    dpi: params.dpi as number,
    title: titleStr,
    xLabel: xl,
    yLabel: yl,
    greyscale: params.greyscale as boolean,
  };
  // F4.2c (a): a figure with excluded rows asks "greyed or omitted?" first.
  await exportActive(s, async (stem, ds, signal) => {
    const picked = await chooseExcludedRows(
      (greyExcluded) => {
        const o = { ...opts, greyExcluded };
        return buildSpec ? buildSpec(stem, ds, o) : buildStageFigureSpec(s, ds, stem, o);
      },
      excludedChoiceMatters,
      s().excludedDisplay,
    );
    if (!picked) return false;
    // A stack/inset view the request cannot carry says so first (lib/screenOnlyExport.ts).
    if (!buildSpec && !(await confirmScreenOnlyExport(s(), picked.value, "Export"))) return false;
    await exportFigure(picked.value, signal);
  });
}
