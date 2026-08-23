// "Copy figure" (MAIN_PLAN #35) — put a PUBLICATION-quality raster of the
// current plot on the clipboard, in one click, with no dialog.
//
// The gap this closes: the older snapshot composited the live uPlot canvas at
// screen resolution, so what landed in PowerPoint disagreed with what the
// vector export produced — different fonts, line widths, tick formats, legend
// placement, multi-panel layout. This command builds the SAME FigureSpec the
// "Export figure…" command builds (`lib/figureSpec.buildStageFigureSpec`) and
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

import { renderFigureBlob } from "./api/figures";
import {
  clipboardImageSupported,
  clipboardSvgSupported,
  copyImageAsync,
  copySvgAsync,
} from "./clipboard";
import { exportActive, type StoreGet } from "./exportActive";
import { buildStageFigureSpec } from "./figureSpec";
import { toast } from "../store/toasts";

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

/** MAIN #35: vector copy, offered only where the browser will actually take an
 *  SVG on the clipboard (see clipboardSvgSupported — the sanctioned MIME set
 *  excludes it almost everywhere today). Same spec, same renderer, same
 *  gesture-preserving write as the raster copy; only `fmt` differs. */
export async function runCopyFigureSvgCommand(s: StoreGet): Promise<void> {
  if (!clipboardSvgSupported()) {
    const msg = "this browser can't put SVG on the clipboard — use Export figure…";
    s().setStatus(msg);
    toast(msg, "danger");
    return;
  }
  await exportActive(
    s,
    async (stem, ds) => {
      const spec = buildStageFigureSpec(
        s,
        ds,
        stem,
        {
          fmt: "svg",
          style: COPY_FIGURE_STYLE,
          dpi: COPY_FIGURE_DPI, // ignored by vector, sent for spec symmetry
          title: s().plotTitle,
          xLabel: s().xAxisLabel,
          yLabel: s().yAxisLabel,
        },
        { transparent: s().copyFigureTransparent },
      );
      s().setStatus("rendering vector figure for the clipboard…");
      const ok = await copySvgAsync(renderFigureBlob(spec));
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
    async (stem, ds) => {
      const spec = buildStageFigureSpec(
        s,
        ds,
        stem,
        {
          fmt: COPY_FIGURE_FMT,
          style: COPY_FIGURE_STYLE,
          dpi: COPY_FIGURE_DPI,
          title: s().plotTitle,
          xLabel: s().xAxisLabel,
          yLabel: s().yAxisLabel,
        },
        // Background is a preference rather than a fixed choice: transparent
        // pastes cleanly onto a coloured slide, opaque is safer for Word and
        // print. Set in Preferences ▸ Plot; opaque by default so a copy looks
        // like an export.
        { transparent: s().copyFigureTransparent },
      );
      // Progress feedback: a large multi-panel render is not instant, and a
      // silent pause reads as a broken button.
      s().setStatus("rendering figure for the clipboard…");
      // Hand the PENDING render to the clipboard rather than awaiting first —
      // see copyImageAsync: awaiting can drop the user activation the
      // Clipboard API requires, and the copy then fails invisibly.
      const ok = await copyImageAsync(renderFigureBlob(spec));
      s().setStatus("");
      if (!ok) throw new Error("clipboard write refused");
    },
    { verb: "copy", past: "copied" },
  );
}
