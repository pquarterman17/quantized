// The polar view's publication request: what "Export figure…", "Copy figure"
// and "Send figure to report" send while the Stage shows the polar canvas.
//
// They used to send the ordinary XY request, and the renderer drew a Cartesian
// figure — silent wrong output. This builds the request from the SAME inputs
// `Stage/PolarStageCore` draws from, through the same helpers (`lib/polar.ts`):
//   - angle = the `time` column (no `x_key`), radius = `polarChannels(yKeys)`;
//   - the raw `dataset.data` — the canvas has never honoured exclusions (see
//     PolarStageCore's header), so the export does not either, and the
//     excluded-rows question never fires for a polar figure;
//   - `POLAR_CANVAS` (degrees, counter-clockwise, 0 east), the shared radial
//     range `polarRadialRange` (min at the centre, values clamped) and the
//     `niceTicks` rings, all sent explicitly (`routes/export_figures_polar`);
//   - per-series COLOUR only, at the canvas' palette positions — the canvas
//     draws every series as one solid line, so width/dash/marker are not sent;
//   - the grid toggle; legend renames.
// Imported only by lazily-loaded export modules (via figureSpecStage).

import type { FigureSpec } from "./api/figures";
import { buildExportStyles, toWireSeriesStyles } from "./exportStyles";
import type { FigureRenderOpts } from "./figureSpec";
import { pageSizeInches } from "./pagesetup";
import type { PlotView } from "./plotview";
import { POLAR_CANVAS, polarChannels, polarRadialRange } from "./polar";
import { niceTicks } from "./ticks";
import type { Dataset } from "./types";

export type PolarSpecView = Pick<PlotView, "yKeys" | "seriesStyles" | "seriesLabels" | "showGrid" | "pageSetup">;

export function buildPolarFigureSpec(
  st: PolarSpecView,
  ds: Dataset,
  stem: string,
  o: FigureRenderOpts,
): FigureSpec {
  const channels = polarChannels(st.yKeys, ds.data.labels.length);
  const rLim = polarRadialRange(ds.data.values, channels);
  const styles = toWireSeriesStyles(buildExportStyles(channels, st.seriesStyles), false).map((s, i) => {
    const legend = st.seriesLabels[channels[i]];
    const keep = { ...(s?.color ? { color: s.color } : {}), ...(legend ? { legend } : {}) };
    return Object.keys(keep).length > 0 ? keep : null;
  });
  return {
    dataset: ds.data,
    y_keys: channels,
    polar: { ...POLAR_CANVAS, r_lim: rLim, r_ticks: niceTicks(rLim[0], rLim[1]), grid: st.showGrid },
    fmt: o.fmt,
    style: o.style,
    dpi: o.dpi,
    ...(st.pageSetup ? pageSizeInches(st.pageSetup) : {}),
    title: o.title,
    x_label: o.xLabel || undefined,
    y_label: o.yLabel || undefined,
    ...(styles.some((s) => s !== null) ? { series_styles: styles } : {}),
    ...(o.greyscale ? { greyscale: true } : {}),
    filename: stem,
  };
}
