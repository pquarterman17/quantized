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
// values are scaled by the decade offset of the Y it is bound to (the first
// plotted channel's when unbound), as `Stage/usePlotPayloadLogOffsets` does,
// and are never waterfall-shifted.
// The Curve Fit's confidence/prediction band (`FitOverlay.band`) rides with its
// curve: each edge is one more column right after the fit, dashed in the fit's
// own colour, and every LOWER edge is filled up to its upper edge (`fill:
// {vs}`, the renderer's `fill_between`) — what `uplotSeries` shades on screen.
// Without it the canvas showed a shaded band and the SVG/PDF a bare curve.
// Grouped, encoded, faceted and polar requests are returned unchanged: their
// rows are re-split server-side, so a row-aligned column has no place there.
// A per-series-X request (lib/figureSpecPerSeriesX) carries the blocks x n
// view rows; each overlay is placed into its bound X's block by
// lib/overlayPlacement -- the placement the canvas draws -- and the wire's X
// must match the view's X row for row, or nothing is appended (fail closed).
// Imported only by lazily-loaded export modules.

import type { FigureSpec } from "./api/figures";
import { resolveToHex } from "./color";
import { traceSeriesStyles } from "./exportDefaultTrace";
import { lineWidthSeriesStyles } from "./exportLineWidth";
import { canvasLineWidth } from "./plotTemplates";
import type { ExportSeriesStyle } from "./publicationStyles";
import { overlayDecadesFromStyles } from "./logOffset";
import { droppedRows } from "./rowstate";
import { seriesColor } from "./seriesStyleCycle";
import { overlayLayout, placeOverlay, type OverlayLayout } from "./overlayPlacement";
import { perSeriesXDataset } from "./perSeriesX";
import { shownCurves } from "./shownCurves";
import type { BaselineOverlay, Dataset, DefaultTrace, FitOverlay, OverlayBinding, PeakOverlay, SeriesStyle } from "./types";

/** The live view fields the overlays are read from (all on the app store). */
export interface OverlayView {
  fitOverlay: FitOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  peakOverlay: PeakOverlay | null;
  plotTemplate: string;
  defaultLineWidth?: number;
  defaultTrace?: DefaultTrace;
  /** The plot binding, which decides the per-series-X blocks (lib/shownCurves). */
  xKey: number | null;
  yKeys: number[] | null;
  seriesOrder: number[] | null;
  hiddenChannels: readonly number[];
  /** Per-channel styles: the decade offsets an overlay inherits (the canvas'
   *  source). Absent = no offsets. */
  seriesStyles?: Record<number, SeriesStyle>;
}

/** The rows the overlays align to: `ds` itself, or on a per-series-X sheet the
 *  same blocks x n view the canvas and the request are built from. */
function overlayTarget(ds: Dataset, view: OverlayView): { target: Dataset; layout: OverlayLayout } {
  const shown = shownCurves(ds.data, view, ds.channelRoles);
  const v = perSeriesXDataset(ds, view.xKey, shown);
  return { target: v?.dataset ?? ds, layout: overlayLayout(ds, view.xKey, v?.blocks, shown) };
}

/** Same X, row for row (NaN = NaN): the wire really is `target`'s rows. */
function sameX(spec: FigureSpec, target: Dataset, rows: readonly number[]): boolean {
  const t = target.data.time;
  return rows.every((r, i) => {
    if (r < 0) return true;
    const a = spec.dataset.time[i];
    const b = t[r];
    return a === b || (Number.isNaN(Number(a)) && Number.isNaN(Number(b)));
  });
}

/** Peak markers' size on the canvas (`uplotSeries`: `points.size: 8`). */
const PEAK_MARKER_PX = 8;
/** A fit-band edge's line width on the canvas (`uplotSeries`: `width: 1`). */
const BAND_EDGE_PX = 1;

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
  const { target, layout } = overlayTarget(ds, view);
  const n = target.data.time.length;
  const candidates: [string, FitOverlay | null | undefined, boolean][] = [
    ["fit", placeOverlay(view.fitOverlay, layout), false],
    ["baseline", placeOverlay(view.baselineOverlay, layout), false],
    ["peaks", placeOverlay(view.peakOverlay, layout), true],
  ];
  // `band` is `PlotSeriesSpec.band`: how many series back the edge's curve is
  // (0 = not a band edge); an odd value is a lower edge.
  // The bound Y's offset: the canvas' rule (lib/logOffset.overlayDecadesFromStyles),
  // read from the same series styles by CHANNEL, so it does not depend on which
  // channels this request lists. `log_offsets` present = offsets apply here.
  const channelStyles = view.seriesStyles ?? {};
  const factorFor = (o: { binding?: OverlayBinding | null }): number =>
    spec.log_offsets ? 10 ** overlayDecadesFromStyles(o.binding, channelStyles, keys as number[], view.hiddenChannels) : 1;
  const present = candidates.flatMap(([label, o, points]) => {
    if (!o || o.datasetId !== ds.id || o.y.length < n) return [];
    const edges = (o.band ?? []).every((e) => e.y.length >= n) ? (o.band ?? []) : [];
    return [
      { label, legend: label, y: o.y, points, band: 0, factor: factorFor(o) },
      ...edges.map((e, k) => ({
        label: e.label, legend: e.legend ?? e.label, y: e.y, points: false, band: k + 1, factor: factorFor(o),
      })),
    ];
  });
  if (present.length === 0) return spec;
  const rows = wireRows(spec, target, grey.wire);
  if (!rows || (target !== ds && !sameX(spec, target, rows))) return spec; // a view: its X, row for row

  const width = spec.dataset.labels.length;
  const values = spec.dataset.values.map((row, i) => [
    ...row.slice(0, width),
    ...present.map((o) => {
      const v = rows[i] < 0 ? null : o.y[rows[i]];
      return v == null || !Number.isFinite(v) ? Number.NaN : v * o.factor;
    }),
  ]);
  // The canvas colours each display series by its position: channels, then
  // their grey companions when any row is greyed, then the overlays.
  const before = canvasSeries * (grey.screen && droppedRows(ds).size > 0 ? 2 : 1);
  const lineKeys = present.map((_p, i) => width + i);
  const base: ExportSeriesStyle[] = present.map(({ legend, points, band }, i) => {
    // A band edge takes its curve's colour (the canvas does the same), though
    // it still occupies its own display position for whatever follows it.
    const color = resolveToHex(seriesColor(before + i - band));
    return {
      ...(color ? { color } : {}),
      // "" = no legend entry (a band's upper edge): matplotlib drops it.
      legend,
      ...(points ? { line: "none" as const, marker: true, marker_size: PEAK_MARKER_PX } : {}),
      ...(band ? { line: "dashed" as const, width: BAND_EDGE_PX, ...(band % 2 ? { fill: { vs: width + i + 1 } } : {}) } : {}),
    };
  });
  // The two LINES take the canvas' default trace and line width, as an
  // unstyled channel does; the markers and band edges are fully specified.
  const traced = traceSeriesStyles(base, lineKeys, view.defaultTrace, {}) ?? base;
  const widened =
    lineWidthSeriesStyles(traced, lineKeys, canvasLineWidth(view.plotTemplate, view.defaultLineWidth)) ?? traced;
  const styles = widened.map((st, i) => (present[i].points || present[i].band ? base[i] : st));
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
