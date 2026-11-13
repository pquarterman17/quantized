// The Publication preview's page size + axis tick formats glue (publication-
// figures audit #5). Pure binding helpers — useFigureBuilder.ts sits at its
// size ceiling, so each feature's per-field wiring lives beside it as one call
// (the same move canonicalRegionShades.ts's `regionShadeBindings` made).
//
// The page is the figure's ONE size source of truth, shared with the Page
// setup and Export dialogs: a canonical session edits its draft's
// `plot.view.pageSetup` (applied to the window with the rest of the draft),
// a legacy (mirror-the-live-plot) session edits the live window's page
// directly, and its request carries the page like the Stage export does.

import type { FigureSpec } from "../../../lib/api/figures";
import type { FigureViewState } from "../../../lib/figureDocument";
import { compactOverrides } from "../../../lib/figureOverrides";
import { marginFractions, pageSizeInches } from "../../../lib/pageGeometry";
import type { PageSetup } from "../../../lib/pagesetup";
import type { AxisFormat } from "../../../lib/types";

/** `pageSetup` + its setter for the preview's Canvas group. */
export function pageSetupBinding(
  canonicalView: FigureViewState | null,
  setCanonicalView: (patch: Partial<FigureViewState>) => void,
  live: { pageSetup: PageSetup | null; setPageSetup: (next: PageSetup | null) => void },
) {
  return canonicalView
    ? { pageSetup: canonicalView.pageSetup, setPageSetup: (next: PageSetup) => setCanonicalView({ pageSetup: next }) }
    : { pageSetup: live.pageSetup, setPageSetup: (next: PageSetup) => live.setPageSetup(next) };
}

/** A legacy preview/export request sized by the live window's page, exactly
 *  as `buildFigureSpecForView` sizes the Stage export: figsize in inches, the
 *  margins as outer padding (`page_pad`). No page: the request is unchanged
 *  (the preset's size). */
export function withPageSetup(ps: PageSetup | null | undefined, spec: FigureSpec): FigureSpec {
  if (!ps) return spec;
  const overrides = compactOverrides({ ...(spec.overrides ?? {}), page_pad: marginFractions(ps) });
  return { ...spec, ...pageSizeInches(ps), overrides: overrides ?? undefined };
}

/** F2.3e: axis tick formats are canonical-only PlotView fields — and they
 *  already reach the renderer (figureSpec's x_fmt/y_fmt + secondaryAxisWire's
 *  y2_fmt), so the panel was the only missing piece. y2Fmt null = inherit Y,
 *  the Stage's own rule. Moved out of useFigureBuilder.ts to fund the page
 *  binding above. */
export function tickFormatBindings(setCanonicalView: (patch: Partial<FigureViewState>) => void) {
  return {
    setXFmtCanonical: (next: AxisFormat) => setCanonicalView({ xFmt: next }),
    setYFmtCanonical: (next: AxisFormat) => setCanonicalView({ yFmt: next }),
    setY2FmtCanonical: (next: AxisFormat | null) => setCanonicalView({ y2Fmt: next }),
  };
}
