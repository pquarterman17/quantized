// The stat-mode branches of "Export figure…", "Copy figure", "Copy figure
// (vector)" and "Send figure to report". With the statistics stage on screen
// those commands must produce the STAT plot, not an XY figure of the
// underlying data, so each one asks `activeStatExporter` first and, when the
// focused stat stage registered one (lib/statStageBridge.ts), comes here:
//   - Export figure… downloads the stage's own export (Stage/statStageExport.ts)
//     in the dialog's format, style and DPI;
//   - the copies put the stat renderer's own PNG / SVG on the clipboard;
//   - Send embeds the stat renderer's PNG as the report block's `image` (a
//     report `spec` is an XY `/api/export/figure` body and cannot carry a stat
//     plot; the report exporter embeds an attached PNG in every format, which
//     an attached SVG it cannot do for Office, so the send is always PNG).
// No stat stage to route to (it has not mounted yet) falls through to the XY
// path, whose screen-only confirm says so first (lib/screenOnlyExport.ts).
//
// Known gap: the stat routes have no `svg_text_as_paths`, so a vector copy of
// a stat plot keeps live SVG text, unlike the XY copy's outlined glyphs.
// Imported only by lazily-loaded command modules.

import { copySvgAsync } from "./clipboard";
import type { StoreGet } from "./exportActive";
import { copyOfficeGraphicAsync } from "./officeClipboard";
import type { ReportFigureBlock } from "./report";
import { renderStatFigureBlob, type StatExportOut, type StatStageExporter } from "./statStageBridge";
import { toast } from "../store/toasts";

/** "Export figure…": the stage's own export, reported like the stage's button. */
export async function exportStatFigure(
  s: StoreGet,
  exporter: StatStageExporter,
  fmt: string,
  out: StatExportOut,
): Promise<void> {
  try {
    const done = await exporter(fmt, out);
    s().setStatus(done ? "exported statistical-plot figure" : "export cancelled");
  } catch (e) {
    const msg = `export failed: ${e instanceof Error ? e.message : "error"}`;
    s().setStatus(msg);
    toast(msg, "danger");
  }
}

/** Copy the stat renderer's PNG (Office-ready) or SVG. The render starts before
 *  the first await, so the clipboard write keeps this click's activation. */
export async function copyStatFigure(
  exporter: StatStageExporter,
  fmt: "png" | "svg",
  out: StatExportOut & { dpi: number; signal: AbortSignal },
  alt: string,
): Promise<void> {
  const blob = renderStatFigureBlob(exporter, fmt, out);
  const ok =
    fmt === "svg"
      ? await copySvgAsync(blob, out.signal)
      : await copyOfficeGraphicAsync({ png: blob, svg: null, pngDpi: out.dpi, alt }, out.signal);
  if (!ok) throw new Error("clipboard write refused");
}

/** Base64 of a blob, chunked so a large PNG cannot overflow the call stack. */
async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A report figure block holding the stat renderer's PNG (no XY `spec`). */
export async function statReportBlock(
  exporter: StatStageExporter,
  out: StatExportOut,
  name: string,
  caption: string,
): Promise<ReportFigureBlock> {
  const png = await renderStatFigureBlob(exporter, "png", out);
  const block: ReportFigureBlock = { type: "figure", name, image: { mime: "image/png", data: await base64Of(png) } };
  const c = caption.trim();
  if (c) block.caption = c;
  return block;
}
