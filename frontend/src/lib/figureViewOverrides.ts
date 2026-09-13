// The screen-parity OVERRIDE projection (MAIN #18 and its successors): one
// `PlotView` -> the `FigureOverrides` bag every export request carries. Split
// out of lib/figureSpec.ts, which sits on the general 500-line .ts ceiling with
// FOUR lines of headroom (the guard counts `src.split("\n").length`, i.e. `wc -l`
// plus one for the trailing newline — so 495 counts as 496, not 495; the first
// cut of this header said five) — P3.3's auto dash/marker cycle had to be threaded
// through both of that file's entry points, so this cohesive block moved out to
// fund it rather than the ceiling moving up. Nothing about the projection
// changed — only the module name its three importers reach for
// (`figureSpec.ts`, `figurebuilder/canonicalOverrides.ts`, and
// `exportFigureCommand.test.ts`, which pulls `liveViewOverrides` in by name).
//
// Deliberately NOT here: `error_spans`. Error-bar concepts have no override
// representation at all — they ride their own request field, built by
// `figureSpec.exportErrorSpans`. See `viewOverrides`' own doc below.

import type { StoreGet } from "./exportActive";
import { compactOverrides, legendPosToLoc, type FigureOverrides } from "./figureOverrides";
import type { PlotView } from "./plotview";


/** Screen-parity overrides (MAIN #18): annotations (with their pointer-tool
 *  `size` override) + the legend's screen position — free `legendXY`
 *  (fractions) maps to matplotlib's `loc: "custom"` + `anchor`
 *  (`calc.figure_overrides`' pre-existing #14 drag-to-place handling); a
 *  corner `legendPos` maps through `legendPosToLoc`. A page-anchored
 *  annotation (MAIN #21) carries `anchor: "page"` through so the backend
 *  renders it as figure-fraction placement instead of axes-data coords —
 *  see `calc.figure_overrides._apply_overrides`'s y-flip. MAIN #27 adds
 *  `shapes` (drawn arrow/line/rect/ellipse marks) and an annotation's
 *  `frame` ("text box") — see `calc.figure_shapes._apply_shapes`.
 *  The same override carries live finite x/y limits, grid, axis-box spines,
 *  and log minor-tick state through fields the backend already supports.
 *  A live secondary-axis range (`y2Lim`) rides `y2_lim` through this SAME
 *  override mechanism (only meaningful alongside a request that also sets
 *  `y2_keys`). Export-fidelity gap (2026-08-11) closed: `refLines` and
 *  `regionShades` now ride `ref_lines`/`region_shades` the same way —
 *  see `calc.figure_decor`. Error-bar concepts remain unsupported HERE
 *  (they ride a separate `error_spans` field built by `exportErrorSpans`
 *  below, not this override object). */
export function viewOverrides(st: Pick<
  PlotView,
  | "legendTitle"
  | "showLegend"
  | "legendFrameXY"
  | "legendXY"
  | "legendPos"
  | "annotations"
  | "shapes"
  | "refLines"
  | "regionShades"
  | "xLim"
  | "yLim"
  | "y2Lim"
  | "showGrid"
  | "showAxisBox"
  | "xScale"
  | "yScale"
>): FigureOverrides | undefined {
  // Decode #52: the legend title (Origin's bold header) rides the legend
  // override so vector export matches the screen's static legend.
  const legendTitle = st.legendTitle ? { title: st.legendTitle } : {};
  // Precedence matches the screen (decode #52): a frame anchor (`legendFrameXY`,
  // an AXES fraction — `loc: "axes"`, exact via ax.transAxes) beats a free
  // container fraction (`legendXY` → figure-fraction `loc: "custom"`, MAIN #14),
  // which beats the corner preset.
  const legend: FigureOverrides["legend"] = st.showLegend
    ? st.legendFrameXY
      ? { show: true, loc: "axes", anchor: st.legendFrameXY, ...legendTitle }
      : st.legendXY
        ? { show: true, loc: "custom", anchor: st.legendXY, ...legendTitle }
        : { show: true, loc: legendPosToLoc(st.legendPos), ...legendTitle }
    : { show: false };
  const annotations = st.annotations
    .filter((a) => Number.isFinite(a.x) && Number.isFinite(a.y))
    .map((a) => ({
      x: a.x,
      y: a.y,
      text: a.text,
      ...(a.size ? { size: a.size } : {}),
      ...(a.anchor === "page" ? { anchor: "page" as const } : {}),
      ...(a.frame ? { frame: a.frame } : {}),
    }));
  // MAIN #27: drawn shapes, wire-shaped (no `id` — the render request needs no
  // identity, unlike the screen's editable list).
  const shapes = st.shapes
    .filter((s) => [s.x1, s.y1, s.x2, s.y2].every(Number.isFinite))
    .map((s) => ({
      kind: s.kind,
      x1: s.x1,
      y1: s.y1,
      x2: s.x2,
      y2: s.y2,
      ...(s.anchor === "page" ? { anchor: "page" as const } : {}),
      ...(s.stroke ? { stroke: s.stroke } : {}),
      ...(s.fill ? { fill: s.fill } : {}),
      ...(s.opacity != null ? { opacity: s.opacity } : {}),
      ...(s.width != null ? { width: s.width } : {}),
      ...(s.dash ? { dash: s.dash } : {}),
    }));
  // Export-fidelity gap (2026-08-11): fixed X/Y reference lines (Hc/Tc
  // markers…), wire-shaped (no `id` — same reasoning as `shapes` above).
  const refLines = st.refLines
    .filter((r) => Number.isFinite(r.value))
    .map((r) => ({ axis: r.axis, value: r.value }));
  // Filled region bands (Origin `Rect*` shading, decode-plan #41). `axis: 1`
  // rides through explicitly; 0/absent are equivalent (both mean primary to
  // every consumer, screen and backend alike) so both are omitted the same
  // way — `calc.figure_decor` resolves the axis-1-without-a-real-y2-axis
  // fallback on the backend itself, mirroring the screen's own
  // `regionShadePlugin` fallback, so this mapping does not need to know
  // whether `y2Keys` is actually set.
  const regionShades = st.regionShades
    .filter((r) => [r.x1, r.x2, r.y1, r.y2].every(Number.isFinite))
    .map((r) => ({
      x1: r.x1,
      x2: r.x2,
      y1: r.y1,
      y2: r.y2,
      fill: r.fill,
      ...(r.axis === 1 ? { axis: 1 as const } : {}),
    }));
  const finiteLim = (lim: [number, number] | null): [number, number] | undefined =>
    lim && lim.every(Number.isFinite) ? lim : undefined;
  return (
    compactOverrides({
      legend,
      annotations,
      shapes,
      ref_lines: refLines,
      region_shades: regionShades,
      x_lim: finiteLim(st.xLim),
      y_lim: finiteLim(st.yLim),
      y2_lim: finiteLim(st.y2Lim),
      grid: st.showGrid,
      spines: { top: st.showAxisBox, right: st.showAxisBox },
      ticks: st.xScale === "log" || st.yScale === "log" ? { minor: true } : undefined,
    }) ?? undefined
  );
}

/** Store facade retained for existing callers and tests. */
export function liveViewOverrides(s: StoreGet): FigureOverrides | undefined {
  return viewOverrides(s());
}
