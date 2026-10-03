// The canvas' ANALYSIS overlays — a fit curve, an estimated baseline, peak
// markers — on the figure export.
//
// WHY. `lib/plotdata.composeDisplayPayload` splices the fit / baseline / peak
// overlays onto the drawn payload after the plotted channels, each with a
// legend entry ("fit", "baseline", "peaks"). The export request never carried
// them, so a Peak Analyzer model fit, a peak-find result or a reflectivity fit
// exported as bare data (round-3 plot audit: an XRD pattern with 14 peak
// markers and a legend entry on screen, none of either in the SVG). The ROI
// differentiate preview (`derivOverlay`, a secondary-axis gadget preview) is
// deliberately NOT exported: it is a transient tool readout, not a result.
//
// HOW. Each overlay rides as one more dataset column + `y_keys` entry on a
// FLAT request — the same additive shape `excludedRowsExport.withExcludedGhosts`
// uses — so log axes, limits and legend placement treat it exactly like data.
// Its style mirrors `uplotSeries.buildSeriesDefs`: the palette slot at its
// DISPLAY position (after every plotted channel, and after the grey
// "(excluded)" companions when those draw), the canvas line width and default
// trace for the two lines, and size-8 markers with no line for the peaks. Its
// values are scaled by the first plotted channel's decade offset, as
// `Stage/usePlotPayloadLogOffsets` does, and are never waterfall-shifted.
// Grouped, encoded, faceted and polar requests are returned unchanged: their
// rows are re-split server-side, so a row-aligned column has no place there.
// Imported only by lazily-loaded export modules.

import type { FigureSpec } from "./api/figures";
import { resolveToHex } from "./color";
import { traceSeriesStyles } from "./exportDefaultTrace";
import { lineWidthSeriesStyles } from "./exportLineWidth";
import { canvasLineWidth } from "./plotTemplates";
import type { ExportSeriesStyle } from "./publicationStyles";
import { droppedRows } from "./rowstate";
import { seriesColor } from "./seriesStyleCycle";
import type { BaselineOverlay, Dataset, DefaultTrace, FitOverlay, PeakOverlay } from "./types";

/** The live view fields the overlays are read from (all on the app store). */
export interface OverlayView {
  fitOverlay: FitOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  peakOverlay: PeakOverlay | null;
  plotTemplate: string;
  defaultLineWidth?: number;
  defaultTrace?: DefaultTrace;
}

/** Peak markers' size on the canvas (`uplotSeries`: `points.size: 8`). */
const PEAK_MARKER_PX = 8;

/** Original row index of each wire row, or null when the wire rows cannot be
 *  matched to `ds` (then nothing is appended). Ghost rows map to -1. */
function wireRows(spec: FigureSpec, ds: Dataset, grey: boolean): number[] | null {
  const n = ds.data.time.length;
  const len = spec.dataset.time.length;
  const dropped = droppedRows(ds);
  const kept: number[] = [];
  for (let r = 0; r < n; r++) if (!dropped.has(r)) kept.push(r);
  if (dropped.size === 0) return len === n ? kept : null;
  if (len === kept.length) return kept;
  // `withExcludedGhosts` re-orders the rows as [...kept, ...lost].
  if (grey && len === n) return [...kept, ...new Array<number>(n - kept.length).fill(-1)];
  return null;
}

/** Where greyed "(excluded)" companions are drawn: `screen` on the canvas
 *  (they shift the overlays' palette slots), `wire` in this request (they
 *  re-order its rows — `withExcludedGhosts`). */
export interface OverlayGrey {
  screen: boolean;
  wire: boolean;
}

/** `spec` with the canvas' analysis overlays for `ds` appended as extra
 *  series, or `spec` itself when there are none it can carry. `canvasSeries`
 *  is how many channel series the canvas draws before them. */
export function withAnalysisOverlays(
  spec: FigureSpec,
  ds: Dataset,
  view: OverlayView,
  canvasSeries: number,
  grey: OverlayGrey = { screen: false, wire: false },
): FigureSpec {
  if (spec.polar || spec.facets || spec.encoding || spec.group_col != null) return spec;
  const keys = spec.y_keys;
  if (!keys?.length || keys.some((k) => typeof k !== "number")) return spec;
  const n = ds.data.time.length;
  const candidates: [string, FitOverlay | null | undefined, boolean][] = [
    ["fit", view.fitOverlay, false],
    ["baseline", view.baselineOverlay, false],
    ["peaks", view.peakOverlay, true],
  ];
  const present = candidates.flatMap(([label, o, points]) =>
    o && o.datasetId === ds.id && o.y.length >= n ? [{ label, y: o.y, points }] : [],
  );
  if (present.length === 0) return spec;
  const rows = wireRows(spec, ds, grey.wire);
  if (!rows) return spec;

  const factor = 10 ** (spec.log_offsets?.[0] ?? 0);
  const width = spec.dataset.labels.length;
  const values = spec.dataset.values.map((row, i) => [
    ...row.slice(0, width),
    ...present.map((o) => {
      const v = rows[i] < 0 ? null : o.y[rows[i]];
      return v == null || !Number.isFinite(v) ? Number.NaN : v * factor;
    }),
  ]);
  // The canvas colours each display series by its position: channels, then
  // their grey companions when any row is greyed, then the overlays.
  const before = canvasSeries * (grey.screen && droppedRows(ds).size > 0 ? 2 : 1);
  const lineKeys = present.map((_p, i) => width + i);
  const base: ExportSeriesStyle[] = present.map(({ label, points }, i) => {
    const color = resolveToHex(seriesColor(before + i));
    return {
      ...(color ? { color } : {}),
      legend: label,
      ...(points ? { line: "none" as const, marker: true, marker_size: PEAK_MARKER_PX } : {}),
    };
  });
  // The two LINES take the canvas' default trace and line width, as an
  // unstyled channel does; the markers are already fully specified.
  const traced = traceSeriesStyles(base, lineKeys, view.defaultTrace, {}) ?? base;
  const widened =
    lineWidthSeriesStyles(traced, lineKeys, canvasLineWidth(view.plotTemplate, view.defaultLineWidth)) ?? traced;
  const styles = widened.map((st, i) => (present[i].points ? base[i] : st));
  const pad = <T>(list: T[] | undefined, v: T): T[] | undefined => (list ? [...list, ...present.map(() => v)] : undefined);
  return {
    ...spec,
    dataset: {
      ...spec.dataset,
      values,
      labels: [...spec.dataset.labels, ...present.map((o) => o.label)],
      units: [...spec.dataset.units, ...present.map(() => "")],
    },
    y_keys: [...keys, ...lineKeys],
    series_styles: [...(spec.series_styles ?? keys.map(() => null)), ...styles],
    ...(spec.error_spans ? { error_spans: pad(spec.error_spans, null) } : {}),
    ...(spec.waterfall_offsets ? { waterfall_offsets: pad(spec.waterfall_offsets, 0) } : {}),
    ...(spec.waterfall_x_offsets ? { waterfall_x_offsets: pad(spec.waterfall_x_offsets, 0) } : {}),
    ...(spec.log_offsets ? { log_offsets: pad(spec.log_offsets, 0) } : {}),
  };
}
