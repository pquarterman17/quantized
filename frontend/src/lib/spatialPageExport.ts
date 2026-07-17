// Spatial multi-panel "Export page…" (ORIGIN_FILE_DECODE_PLAN #54 residual):
// assembles a /api/export/figure-page request straight from the decoded
// SpatialPanel `pageRect` geometry (#54 Stage 2), instead of a user-composed
// grid (the Figure Page composer, lib/figurepage.ts + useFigurePage.ts).
// Pure: SpatialPanel[] + a resolved-dataset lookup + PageSetup in ->
// FigurePageSpec out, no store/DOM/fetch — the store-facing command
// (lib/exportPageCommand.ts) resolves each panel's dataset first (the #38
// lazy-book discipline every other export path follows) and calls this.
//
// Fail-closed (no silent fallback to the grid layout, per the #54 residual
// spec): null whenever ANY panel lacks a valid `pageRect`, there is no page
// model, or a panel's dataset can't be resolved. `pageValidRects` is the
// SAME guard the "page" fit mode's on-screen render already uses
// (lib/panelLayout.spatialPixelRects) — the toolbar affordance and this
// command can never disagree about which layouts are exportable.
//
// The decoded pageRect fractions already embed Origin's own page margins
// (they were computed from the frame quads inside the full page) — this
// NEVER adds a `margins` override to a panel's figure payload (unlike
// lib/exportFigureCommand.ts's single-figure path), or the real whitespace
// would be squeezed a second time.

import { buildExportStyles } from "./exportStyles";
import { spatialGridSize, spatialPlottedChannels, type SpatialPanel } from "./multipanel";
import { pageValidRects } from "./panelLayout";
import { pageSizeInches, type PageSetup } from "./pagesetup";
import type { DataStruct } from "./types";
import type { FigurePageSpec, FigureSpec, PagePanelSpec } from "./api";

/** One spatial panel's own dataset + channel selection -> the single-figure
 *  payload the page route embeds — the same field mapping the on-screen
 *  spatial render uses (`useMultiPanelStage.ts`'s per-cell `buildOpts` call):
 *  hidden-filtered `y_keys`, this panel's own log/step axis state, its own
 *  (possibly explicitly-blank) axis labels, and its per-channel styles in
 *  plotted order. */
function spatialPanelFigure(panel: SpatialPanel, dataset: DataStruct): FigureSpec {
  const plotted = spatialPlottedChannels(panel);
  return {
    dataset,
    x_key: panel.xKey ?? undefined,
    y_keys: plotted,
    x_log: panel.xLog,
    y_log: panel.yLog,
    // null = Origin decoded an EXPLICITLY blank title (force blank, never
    // synthesize — see SpatialPanel.xAxisLabel's own doc); undefined = auto.
    x_label: panel.xAxisLabel === null ? "" : panel.xAxisLabel,
    y_label: panel.yAxisLabel,
    x_step: panel.xStep,
    y_step: panel.yStep,
    series_styles: buildExportStyles(plotted, panel.seriesStyles ?? {}),
  };
}

/** True when the spatial view can export at true page coordinates right now:
 *  a page model exists AND every panel carries a valid, in-bounds `pageRect`.
 *  Pure/synchronous (no dataset resolution) so a toolbar button can call it
 *  directly on every render — the same fail-closed check
 *  `buildSpatialPageRequest` re-applies once datasets are resolved. */
export function canExportSpatialPage(
  panels: readonly SpatialPanel[] | null,
  pageSetup: PageSetup | null,
): boolean {
  return !!panels && panels.length > 0 && !!pageSetup && pageValidRects(panels) !== null;
}

/** Assemble a figure-page export request straight from the decoded spatial
 *  panels' page coordinates. `datasets` must already be resolved (full data,
 *  not a lazy-book preview — the #38 discipline lives in the caller). Returns
 *  null (fail-closed) when the page can't be exported faithfully: no panels,
 *  no page model, a panel missing/out-of-bounds `pageRect`, or a panel whose
 *  dataset isn't in `datasets`. `label_format: "none"` — this recreates the
 *  Origin page as-is, not a lettered journal figure. Never sets a `margins`
 *  override (see the module doc). */
export function buildSpatialPageRequest(
  panels: readonly SpatialPanel[],
  datasets: ReadonlyMap<string, DataStruct>,
  pageSetup: PageSetup | null,
): FigurePageSpec | null {
  if (panels.length === 0 || !pageSetup) return null;
  const rects = pageValidRects(panels);
  if (!rects) return null;
  const panelSpecs: PagePanelSpec[] = [];
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const dataset = datasets.get(p.datasetId);
    if (!dataset) return null;
    const r = rects[i];
    panelSpecs.push({
      figure: spatialPanelFigure(p, dataset),
      row: p.row,
      col: p.col,
      page_rect: [r.left, r.top, r.width, r.height],
    });
  }
  const { rows, cols } = spatialGridSize(panels);
  const { width_in, height_in } = pageSizeInches(pageSetup);
  return {
    rows,
    cols,
    panels: panelSpecs,
    label_format: "none",
    width_in,
    height_in,
  };
}
