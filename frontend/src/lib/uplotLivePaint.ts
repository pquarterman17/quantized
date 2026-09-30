// Display-only restyles of a LIVE uPlot instance. A legend hide toggle, or a
// colour / width / dash edit, used to tear the whole instance down and build a
// new one — about 125 ms per rebuild at the 1M-point benchmark scale
// (docs/performance_envelope.md, where removing the zoom rebuild cut F1 zoom
// p95 from 238 to 112 ms). None of those edits changes the series STRUCTURE,
// so PlotViewport now rebuilds only for a structural change and patches the
// live instance for the rest:
//
//  - Colour: every stroke / fill uPlot reads — the line, a fill-under, a
//    glyph marker's stroke and fill, and a fill-between band — is installed as
//    a function reading `LivePaintRef.current`. uPlot re-evaluates those on
//    every draw (`cacheStrokeFill`), so a new colour is one redraw. A default
//    circle marker has no stroke of its own: uPlot aliases it to the series'
//    stroke, which is the same reader, so it follows too.
//  - Width / dash: uPlot keeps these as plain numbers on the live series and
//    reads them at draw time, so they are assigned there directly. A width
//    change also rebuilds the cached paths (the gap clips are width-sized).
//  - Visibility: `u.setSeries(i, {show})`, uPlot's own legend-toggle API.
//
// The new paint comes from `buildSeriesDefs` — the exact code a rebuild runs —
// so a patched instance draws what a rebuilt one would. `shape` is the guard:
// it fingerprints everything about the series that is NOT patchable (scale,
// marker config, path builders, fill presence, bands), and any difference
// makes `applyLivePaint` refuse so the caller rebuilds instead.
//
// uPlot series index 0 is the x series; display series `i` is uPlot index
// `i + 1`, which is why every array here is indexed in uPlot space.

import type uPlot from "uplot";

import type { Lim } from "./plotLimApply";
import type { DefaultTrace, SeriesStyle } from "./types";

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

export interface LivePaintRef {
  current: LivePaint | null;
}

/** Snapshot the paint + structural fingerprint of freshly built series/bands. */
export function livePaintOf(series: readonly uPlot.Series[], bands: readonly uPlot.Band[]): LivePaint {
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

type Reader = (u: uPlot, idx: number) => string;

function readFrom(ref: LivePaintRef, pick: (p: LivePaint, idx: number) => unknown): Reader {
  // Every value read here is a resolved colour string (buildSeriesDefs never
  // emits a function), hence the narrowing for uPlot's stroke/fill types.
  return (_u, idx) => pick(ref.current!, idx) as string;
}

/** Record `opts`' paint in `ref` and swap each colour for a reader of it. */
export function bindLivePaint(opts: uPlot.Options, ref: LivePaintRef): void {
  ref.current = livePaintOf(opts.series, opts.bands ?? []);
  opts.series.forEach((s, i) => {
    if (i === 0) return;
    s.stroke = readFrom(ref, (p, si) => p.series[si].stroke);
    if (s.fill !== undefined) s.fill = readFrom(ref, (p, si) => p.series[si].fill);
    if (s.points?.stroke !== undefined) s.points.stroke = readFrom(ref, (p, si) => p.series[si].pointStroke);
    if (s.points?.fill !== undefined) s.points.fill = readFrom(ref, (p, si) => p.series[si].pointFill);
  });
  opts.bands?.forEach((b) => {
    if (b.fill !== undefined) b.fill = readFrom(ref, (p, bi) => p.bands[bi]);
  });
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

/** Patch the live instance to `next`. Returns false (nothing touched) when
 *  the series structure differs, so the caller must rebuild instead. `lims`
 *  are the committed view limits: a visibility toggle re-ranges y (uPlot's
 *  `setSeries` autoscales that series' scale), so a committed y/y2 limit is
 *  re-applied afterwards, exactly as a rebuild would bake it in. */
export function applyLivePaint(
  u: uPlot,
  ref: LivePaintRef,
  next: LivePaint,
  lims: { y: Lim; y2: Lim },
): boolean {
  const prev = ref.current;
  if (!prev || prev.shape !== next.shape) return false;
  const bandsSame = prev.bands.every((f, bi) => f === next.bands[bi]);
  if (bandsSame && next.series.every((p, i) => i === 0 || samePaint(p, prev.series[i]))) return true;
  ref.current = next;
  u.batch(() => {
    let rescaled = false;
    let widthChanged = false;
    next.series.forEach((p, i) => {
      const s = u.series[i];
      if (i === 0 || !s) return;
      if (s.width !== p.width) widthChanged = true;
      s.width = p.width;
      s.dash = p.dash;
      if (s.show !== p.show) {
        u.setSeries(i, { show: p.show });
        rescaled = true;
      }
    });
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

/** A string that changes only when the per-series styles change STRUCTURE,
 *  for PlotViewport's rebuild deps. Two paint fields still carry one bit of
 *  structure each: whether the effective width is zero (a loop's full-range
 *  line builder is only installed for a drawn line), and, under the "Step"
 *  default trace, whether a dash was set at all (an explicit `line` opts a
 *  series out of the stepped path). Both mirror `buildSeriesDefs`. */
export function styleStructureKey(
  styles: readonly (SeriesStyle | undefined)[] | undefined,
  defaultTrace: DefaultTrace | undefined,
  baseLineWidth: number | undefined,
): string {
  const trace = defaultTrace ?? "Line";
  const keyOf = (st: SeriesStyle): string => {
    const rest = Object.fromEntries(Object.entries(st).filter(([k]) => !PAINT_FIELDS.has(k)));
    const drawn = (st.width ?? (trace === "Scatter" ? 0 : (baseLineWidth ?? 1.5))) > 0;
    return JSON.stringify([rest, drawn, trace === "Step" ? st.line !== undefined : null]);
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
