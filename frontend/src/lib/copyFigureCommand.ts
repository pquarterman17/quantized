// "Copy figure" (MAIN_PLAN #35) — put the publication render of the current
// plot on the clipboard, in one click, with no dialog: the 300-DPI PNG, an
// HTML `<img>` of that same PNG for Office, and — only where the browser
// advertises `image/svg+xml` and the figure is under the point budget — a
// text-as-paths SVG (lib/officeClipboard.ts says what each target receives,
// lib/copySvgBudget.ts when the SVG is rendered). "Copy figure (vector)" is
// that SVG alone, glyphs as paths too: every SVG that goes to the CLIPBOARD
// is text-as-paths, and only an SVG FILE ("Export figure…") keeps live text.
//
// The gap this closes: the older snapshot composited the live uPlot canvas at
// screen resolution, so what landed in PowerPoint disagreed with what the
// vector export produced — different fonts, line widths, tick formats, legend
// placement, multi-panel layout. This command builds the SAME FigureSpec the
// "Export figure…" command builds (`lib/figureSpecStage.buildStageFigureSpec`) and
// posts it to the SAME renderer, so screen-vs-paste parity is structural
// rather than maintained by hand. The screen grab survives as an explicitly
// named "Copy image (screen)" for quick notes.
//
// No dialog on purpose: the workflow this serves is "finished plot -> paste
// into the manuscript in seconds". Format and DPI are therefore fixed at the
// publication defaults rather than prompted.
//
// F2.5b: routes through `buildStageFigureSpec`, not `buildFigureSpec`
// directly — see that function's doc in lib/figureSpec.ts. It prefers the
// focused window's canonical FigureDocument (carrying grouping, axis breaks,
// and publication overrides that the live PlotView singleton cannot
// represent at all) and only falls back to the live-view builder when no
// canonical document applies.

import { renderFigureBlob, type FigureSpec } from "./api/figures";
import { clipboardImageSupported, clipboardSvgSupported, copySvgAsync } from "./clipboard";
import { copySvgWanted, figurePointCount } from "./copySvgBudget";
import { exportActive, type StoreGet } from "./exportActive";
import { chooseExcludedRows } from "./excludedRowsChoice";
import { excludedChoiceMatters } from "./excludedRowsExport";
import type { FigureRenderOpts } from "./figureSpec";
import { buildStageFigureSpec } from "./figureSpecStage";
import { copyOfficeGraphicAsync } from "./officeClipboard";
import { confirmScreenOnlyExport } from "./screenOnlyExport";
import { toast } from "../store/toasts";
import type { Dataset } from "./types";

/** Publication raster defaults. 300 DPI is the standard journal floor and what
 *  the export dialog already defaults to, so a copy and an export of the same
 *  plot produce the same pixels. */
export const COPY_FIGURE_DPI = 300;
export const COPY_FIGURE_FMT = "png";
/** Matches the export dialog's own default. There is no stored style
 *  preference to read — a caller who wants "aps"/"nature"/etc. goes through
 *  "Export figure…", which prompts. Keeping this equal to the dialog default
 *  is what makes copy and export produce identical pixels by default. */
export const COPY_FIGURE_STYLE = "default";

/** The copy's spec, after the F4.2c (a) excluded-rows question when the
 *  figure has any (null = dismissed). Background is a preference rather than
 *  a fixed choice: transparent pastes cleanly onto a coloured slide, opaque is
 *  safer for Word and print (Preferences ▸ Plot; opaque by default so a copy
 *  looks like an export). The question's own click is a fresh user gesture,
 *  so the clipboard write that follows it keeps its activation. */
async function pickCopySpec(
  s: StoreGet,
  ds: Dataset,
  stem: string,
  o: FigureRenderOpts,
): Promise<FigureSpec | null> {
  const picked = await chooseExcludedRows(
    (greyExcluded) =>
      buildStageFigureSpec(s, ds, stem, { ...o, greyExcluded }, { transparent: s().copyFigureTransparent }),
    excludedChoiceMatters,
    s().excludedDisplay,
  );
  const spec = picked?.value ?? null;
  // A stack/inset view the request cannot carry says so first (lib/screenOnlyExport.ts).
  return spec && (await confirmScreenOnlyExport(s(), spec, "Copy")) ? spec : null;
}

/** MAIN #35: vector copy, offered only where the browser will actually take an
 *  SVG on the clipboard (see clipboardSvgSupported — the sanctioned MIME set
 *  excludes it almost everywhere today). Same spec, same renderer, same
 *  gesture-preserving write as the raster copy; only `fmt` differs — and,
 *  like the raster copy's own SVG leg, the glyphs go as PATHS
 *  (`svg_text_as_paths`): a paste target renders live `<text>` with whatever
 *  fonts it has, which for Office is not the figure's. That is a clipboard
 *  rule only — "Export figure…" writes an SVG FILE with editable text, since
 *  a file is something the user may open in Inkscape/Illustrator to edit. */
export async function runCopyFigureSvgCommand(s: StoreGet): Promise<void> {
  if (!clipboardSvgSupported()) {
    const msg = "this browser can't put SVG on the clipboard — use Export figure…";
    s().setStatus(msg);
    toast(msg, "danger");
    return;
  }
  await exportActive(
    s,
    async (stem, ds, signal) => {
      const spec = await pickCopySpec(s, ds, stem, {
        fmt: "svg",
        style: COPY_FIGURE_STYLE,
        dpi: COPY_FIGURE_DPI, // ignored by vector, sent for spec symmetry
        title: s().plotTitle,
        xLabel: s().xAxisLabel,
        yLabel: s().yAxisLabel,
      });
      if (!spec) return false;
      s().setStatus("rendering vector figure for the clipboard…");
      // Glyphs as outlines, as the raster copy's SVG leg asks (see the doc above).
      const ok = await copySvgAsync(renderFigureBlob({ ...spec, svg_text_as_paths: true }, signal), signal);
      s().setStatus("");
      if (!ok) throw new Error("clipboard write refused");
    },
    { verb: "copy", past: "copied (vector)" },
  );
}

export async function runCopyFigureCommand(s: StoreGet): Promise<void> {
  // Check capability BEFORE rendering: on a browser without the async
  // clipboard image API (Firefox, any insecure context) the render would be
  // pure waste and the failure would arrive seconds later for no clear reason.
  if (!clipboardImageSupported()) {
    const msg = "clipboard image unavailable — use Save as PNG or Export figure";
    s().setStatus(msg);
    toast(msg, "danger");
    return;
  }

  await exportActive(
    s,
    async (stem, ds, signal) => {
      const spec = await pickCopySpec(s, ds, stem, {
        fmt: COPY_FIGURE_FMT,
        style: COPY_FIGURE_STYLE,
        dpi: COPY_FIGURE_DPI,
        title: s().plotTitle,
        xLabel: s().xAxisLabel,
        yLabel: s().yAxisLabel,
      });
      if (!spec) return false;
      // Progress feedback: a large multi-panel render is not instant, and a
      // silent pause reads as a broken button.
      s().setStatus("rendering figure for the clipboard…");
      // Every render starts before the first await so clipboard.write()
      // stays in this click's activation task. The SVG is a SECOND render
      // (text as outlines, so the paste needs no installed font), requested
      // only when the browser can take it and the figure is small enough to
      // be worth it (lib/copySvgBudget.ts); otherwise the copy costs one
      // render, as before. PNG requested first: the backend serializes
      // renders, and the optional SVG should not delay the mandatory PNG.
      const png = renderFigureBlob(spec, signal);
      const svg = copySvgWanted(figurePointCount(spec))
        ? renderFigureBlob({ ...spec, fmt: "svg", svg_text_as_paths: true }, signal)
        : null;
      const ok = await copyOfficeGraphicAsync(
        { png, svg, pngDpi: COPY_FIGURE_DPI, alt: spec.title || stem },
        signal,
      );
      s().setStatus("");
      if (!ok) throw new Error("clipboard write refused");
    },
    { verb: "copy", past: "copied" },
  );
}
