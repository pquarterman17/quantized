// The polar view's publication request: what "Export figure…", "Copy figure"
// and "Send figure to report" send while the Stage shows the polar canvas.
//
// They used to send the ordinary XY request, and the renderer drew a Cartesian
// figure — silent wrong output. This builds the request from the SAME inputs
// `Stage/PolarStageCore` draws from, through the same helpers (`lib/polar.ts`):
//   - angle = the `time` column (no `x_key`), radius = `polarChannels(yKeys)`;
//   - the dataset's `analysisData` view, matching the canvas: manual
//     exclusions and Data Filter failures are omitted on both paths;
//   - `POLAR_CANVAS` (degrees, counter-clockwise, 0 east), the shared radial
//     range `polarRadialRange` (min at the centre, values clamped) and the
//     `niceTicks` rings, all sent explicitly (`routes/export_figures_polar`);
//   - per-series COLOUR, at the canvas' palette positions, and the canvas'
//     fixed `POLAR_LINE_PX` width — the canvas draws every series as one solid
//     line at that width, so a series' own width/dash/marker are not sent and
//     the style preset's `line_width` never applies (`exportLineWidth`'s rule);
//   - the grid toggle; legend renames.
// Imported only by lazily-loaded export modules (via figureSpecStage).

import type { FigureSpec } from "./api/figures";
import { buildExportStyles, toWireSeriesStyles } from "./exportStyles";
import type { FigureRenderOpts } from "./figureSpec";
import { pageSizeInches } from "./pageGeometry";
import type { PlotView } from "./plotview";
import { POLAR_CANVAS, POLAR_LINE_PX, polarChannels, polarRadialRange } from "./polar";
import { analysisData } from "./rowstate";
import { niceTicks } from "./niceTicks";
import type { Dataset } from "./types";

export type PolarSpecView = Pick<PlotView, "yKeys" | "seriesStyles" | "seriesLabels" | "showGrid" | "pageSetup">;

export function buildPolarFigureSpec(
  st: PolarSpecView,
  ds: Dataset,
  stem: string,
  o: FigureRenderOpts,
): FigureSpec {
  const data = analysisData(ds) ?? ds.data;
  const channels = polarChannels(st.yKeys, data.labels.length);
  const rLim = polarRadialRange(data.values, channels);
  const styles = toWireSeriesStyles(buildExportStyles(channels, st.seriesStyles), false).map((s, i) => {
    const legend = st.seriesLabels[channels[i]];
    return { ...(s?.color ? { color: s.color } : {}), ...(legend ? { legend } : {}), width: POLAR_LINE_PX };
  });
  return {
    dataset: data,
    y_keys: channels,
    polar: { ...POLAR_CANVAS, r_lim: rLim, r_ticks: niceTicks(rLim[0], rLim[1]), grid: st.showGrid },
    fmt: o.fmt,
    style: o.style,
    dpi: o.dpi,
    ...(st.pageSetup ? pageSizeInches(st.pageSetup) : {}),
    title: o.title,
    x_label: o.xLabel || undefined,
    y_label: o.yLabel || undefined,
    series_styles: styles,
    ...(o.greyscale ? { greyscale: true } : {}),
    filename: stem,
  };
}
