// Display-only restyles of a LIVE uPlot instance. A legend hide toggle, or a
// colour / width / dash edit, used to tear the whole instance down and build a
// new one — about 125 ms per rebuild at the 1M-point benchmark scale
// (docs/performance_envelope.md). None of those edits changes the series
// STRUCTURE, so PlotViewport now rebuilds only for a structural change and
// patches the live instance for the rest:
//
//  - Colour: uPlot keeps every stroke / fill as a function on the live series
//    (initSeries wraps a plain value) and calls it on every draw, so each one
//    is swapped for a function returning the new colour: the line, a
//    fill-under, a glyph marker's stroke and fill, and a fill-between band. A
//    marker with no stroke of its own is re-aliased to the series' stroke,
//    exactly as initSeries aliases it.
//  - Width / dash: plain values on the live series, read at draw time, so they
//    are assigned there directly. A width change also rebuilds the cached
//    paths (the gap clips are width-sized).
//  - Visibility: `u.setSeries(i, {show})`, uPlot's own legend-toggle API.
//
// The paint comes from `buildSeriesDefs`, the exact code a rebuild runs, so a
// patched instance draws what a rebuilt one would. `LivePaintRef` holds the
// style args the instance was last painted from; the previous paint is
// re-derived from them (O(series), no data pass). `shape` is the guard: it
// fingerprints everything about the series that is NOT patchable (scale,
// marker config, path builders, fill presence, bands), and any difference
// makes `livePatch` refuse so the caller rebuilds instead.
//
// uPlot series index 0 is the x series; display series `i` is uPlot index
// `i + 1`, which is why every array here is indexed in uPlot space.
//
// Loaded lazily by PlotViewport (components/Stage/useLivePaint.ts): nothing
// here is needed until the first display-only edit. The caller passes the
// series builder in, so this chunk imports types only: a leaf that moves no
// eager module (a value import here re-split several eager chunks).

import type uPlot from "uplot";

import { seriesTrace } from "./markers";
import type { Lim } from "./plotLimApply";
import type { SeriesStyle } from "./types";
import type { BuildOptsArgs } from "./uplotOpts";
import type { SeriesDefArgs } from "./uplotSeries";

/** One series' patchable paint (uPlot index space; entry 0, the x series, is unused). */
interface SeriesPaint {
  stroke: uPlot.Series["stroke"];
  fill: uPlot.Series["fill"];
  pointStroke: uPlot.Series.Points["stroke"];
  pointFill: uPlot.Series.Points["fill"];
  width: number;
  dash: number[] | undefined;
  show: boolean;
}

export interface LivePaint {
  series: SeriesPaint[];
  bands: uPlot.Band["fill"][];
  /** Fingerprint of everything NOT patchable; see the header. */
  shape: string;
}

/** Every input the live paint reads: the series-def args and the window background. */
export type LivePaintArgs = SeriesDefArgs & Pick<BuildOptsArgs, "bg">;

/** The style args the live instance was last painted from. */
export interface LivePaintRef {
  current: LivePaintArgs | null;
}

/** The paint + structural fingerprint of built (not yet uPlot-initialised) series/bands. */
export function livePaintOf({ series, bands }: { series: readonly uPlot.Series[]; bands: readonly uPlot.Band[] }): LivePaint {
  const shape = series.map((s, i) =>
    i === 0
      ? String(s.sorted)
      : [
          s.scale,
          s.points?.show,
          s.points?.size,
          !!s.points?.paths,
          s.points?.stroke !== undefined,
          s.points?.fill !== undefined,
          s.fill !== undefined,
          s.fillTo !== undefined,
          !!s.paths,
          // uPlot derives a drawn marker's outline width from the LINE width
          // once, at init (initSeries), so a width edit on such a series is
          // structural: only a rebuild re-derives it.
          s.points?.show !== false && s.points?.width === undefined ? (s.width ?? 1) : "",
        ].join(","),
  );
  return {
    series: series.map((s) => ({
      stroke: s.stroke,
      fill: s.fill,
      pointStroke: s.points?.stroke,
      pointFill: s.points?.fill,
      // uPlot's own default for an unset width (initSeries).
      width: s.width ?? 1,
      dash: s.dash,
      show: s.show !== false,
    })),
    bands: bands.map((b) => b.fill),
    shape: [...shape, ...bands.map((b) => b.series.join("-"))].join("|"),
  };
}

// uPlot's `fnOrSelf`: the live series holds every paint as a function.
type PaintFn = (u: uPlot, i: number) => string;
function fnOf(v: unknown): PaintFn {
  // buildSeriesDefs emits resolved colour strings only; a function passes through.
  return typeof v === "function" ? (v as PaintFn) : () => (v ?? null) as string;
}

function samePaint(a: SeriesPaint, b: SeriesPaint): boolean {
  return (
    a.stroke === b.stroke &&
    a.fill === b.fill &&
    a.pointStroke === b.pointStroke &&
    a.pointFill === b.pointFill &&
    a.width === b.width &&
    a.show === b.show &&
    (a.dash ?? []).join() === (b.dash ?? []).join()
  );
}

/** Every series/band def a paint is read from: `buildSeriesDefs` over the
 *  live payload, bound by the caller. */
export type SeriesDefsOf = (args: LivePaintArgs) => { series: uPlot.Series[]; bands: uPlot.Band[] };

/** Patch the live instance `u` (built from `ref.current`) to the paint of
 *  `args`. Returns false (nothing touched) when the series structure
 *  differs, so the caller must rebuild instead. `lims` are the committed view
 *  limits: a visibility toggle re-ranges y (uPlot's `setSeries` autoscales
 *  that series' scale), so a committed y/y2 limit is re-applied afterwards,
 *  as a rebuild bakes it in. */
export function livePatch(
  u: uPlot,
  ref: LivePaintRef,
  args: LivePaintArgs,
  defsOf: SeriesDefsOf,
  lims: { y: Lim; y2: Lim },
): boolean {
  const from = ref.current;
  if (!from || styleStructureKey(from) !== styleStructureKey(args)) return false;
  const prev = livePaintOf(defsOf(from));
  const next = defsOf(args);
  const paint = livePaintOf(next);
  if (prev.shape !== paint.shape) return false;
  ref.current = args;
  const bandsSame = prev.bands.every((f, bi) => f === paint.bands[bi]);
  if (bandsSame && paint.series.every((p, i) => i === 0 || samePaint(p, prev.series[i]))) return true;
  u.batch(() => {
    let rescaled = false;
    let widthChanged = false;
    paint.series.forEach((p, i) => {
      const s = u.series[i];
      if (i === 0 || !s) return;
      if (s.width !== p.width) widthChanged = true;
      s.width = p.width;
      s.dash = p.dash;
      s.stroke = fnOf(p.stroke);
      s.fill = fnOf(p.fill);
      if (s.points) {
        s.points.stroke = p.pointStroke === undefined ? s.stroke : fnOf(p.pointStroke);
        if (p.pointFill !== undefined) s.points.fill = fnOf(p.pointFill);
      }
      if (s.show !== p.show) {
        u.setSeries(i, { show: p.show });
        rescaled = true;
      }
    });
    next.bands.forEach((b, bi) => u.setBand(bi, { series: b.series, fill: fnOf(b.fill) }));
    // A full redraw re-runs the x scale, which re-autoscales an auto y, so
    // the committed limits are re-applied below in that case too.
    u.redraw(widthChanged);
    if (!rescaled && !widthChanged) return;
    (["y", "y2"] as const).forEach((axis) => {
      const lim = lims[axis];
      if (lim && u.scales[axis]) u.setScale(axis, { min: lim[0], max: lim[1] });
    });
  });
  return true;
}

// SeriesStyle fields a live instance can repaint; every OTHER field changes
// the series structure (markers, fill kind, step, colour-by, …) and rebuilds.
// Listing the patchable ones, not the structural ones, keeps a field added to
// SeriesStyle later on the safe (rebuilding) side by default.
const PAINT_FIELDS = new Set<string>(["color", "width", "line"]);

/** A string that changes only when the per-series styles change STRUCTURE:
 *  when it differs, `livePatch` refuses and PlotViewport rebuilds. Two paint
 *  fields still carry one bit of structure each: whether the effective width
 *  is zero (a loop's full-range line builder is only installed for a drawn
 *  line), and, under the "Step" default trace, whether a dash was set at all
 *  (an explicit `line` opts a series out of the stepped path). Both mirror
 *  `buildSeriesDefs`. */
export function styleStructureKey({
  seriesStyles: styles,
  defaultTrace,
  baseLineWidth,
}: Pick<SeriesDefArgs, "seriesStyles" | "defaultTrace" | "baseLineWidth">): string {
  const trace = defaultTrace ?? "Line";
  const keyOf = (st: SeriesStyle): string => {
    const rest = Object.fromEntries(Object.entries(st).filter(([k]) => !PAINT_FIELDS.has(k)));
    const t = seriesTrace(st, trace); // an explicit style opts out, as on the canvas
    const drawn = (st.width ?? (t === "Scatter" ? 0 : (baseLineWidth ?? 1.5))) > 0;
    return JSON.stringify([rest, drawn, t === "Step" ? st.line !== undefined : null]);
  };
  // A series with no style, or a paint-only one, is structurally the default:
  // only the entries that differ from it are keyed, so a first colour edit
  // (undefined -> {color}) or a missing styles list does not read as a change.
  const plain = keyOf({});
  return (styles ?? [])
    .map((st, i) => (st ? keyOf(st) : plain) === plain ? "" : `${i}:${keyOf(st!)}`)
    .filter(Boolean)
    .join("|");
}
