// Preview hit-map helpers (#13/#14) — pure geometry over the backend's
// figure-hitmap payload: hit-test the rendered preview's element boxes, and
// map preview pixels back to data coordinates (for annotation drags) or
// figure fractions (for legend drags). All coords are IMAGE pixels with a
// top-left origin (the backend already flipped matplotlib's bottom-left).

import { reciprocalTransform } from "./uplotOpts";

export interface HitElement {
  id: string; // "title" | "xlabel" | "ylabel" | "legend" | "series:N" | "ann:N"
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** FU-facet-hitmap: which panel (an index into `FigureHitmap.panels`)
   *  this element belongs to. Present ONLY on a faceted response's
   *  elements — absent (undefined) for the flat path, where an id is
   *  already unique across the whole `elements` list. A faceted element's
   *  `id` is NOT unique on its own (every panel has its own "title" and
   *  "series:0") -- pair it with `panel` (e.g. as a React key, or before
   *  acting on a click) whenever more than one panel might be present. */
  panel?: number;
}

export interface AxesInfo {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  xlim: [number, number];
  ylim: [number, number];
  /** Back-compat boolean (pre-MAIN-#12 backend); `xscale`/`yscale` (below)
   *  are the scale-name source of truth when present. */
  xlog: boolean;
  ylog: boolean;
  /** MAIN #12: the ACTUAL resolved axis scale ("linear"/"log"/"reciprocal")
   *  — needed because a reciprocal axis inverts differently from log, and
   *  `xlog`/`ylog` alone can't tell them apart. Absent (older backend
   *  response) falls back to `xlog`/`ylog` — see `axisScaleOf`. */
  xscale?: "linear" | "log" | "reciprocal";
  yscale?: "linear" | "log" | "reciprocal";
}

/** One facet panel's axes geometry (FU-facet-hitmap): everything `AxesInfo`
 *  carries for a SINGLE panel, plus which panel this is (`panels` array
 *  index) and its rendered facet-level label (`ax.get_title()` on the
 *  backend — already sanitized, so it matches what the image shows
 *  verbatim). `FigureHitmap.panels` carries one of these per panel. */
export interface PanelAxesInfo extends AxesInfo {
  panel: number;
  label: string;
}

/** Resolve the effective axis scale for `pxToData`'s inversion: the new
 *  `xscale`/`yscale` field wins when present; else the old `xlog`/`ylog`
 *  boolean maps to "log"/"linear" (mirrors `lib/plotview.ts`'s
 *  `scaleFromLog`, duplicated here to keep this module free of a
 *  store/plotview dependency — it's a pure geometry module). */
function axisScaleOf(scale: "linear" | "log" | "reciprocal" | undefined, log: boolean): "linear" | "log" | "reciprocal" {
  return scale ?? (log ? "log" : "linear");
}

/** FU-facet-hitmap (closes the former R1/fix-round-3 gap): for a facet-bound
 *  spec, `image` is the SAME small-multiples grid `/api/export/figure`
 *  would export, and `panels` now carries ONE real `PanelAxesInfo` per
 *  panel -- the flat single-``axes`` field is absent instead (there is no
 *  single meaningful axes rect for a multi-panel grid). `elements` carries
 *  each panel's facet title, series lines, and legend (when that panel has
 *  more than one series), each tagged with its `panel` index, plus the
 *  whole FIGURE's own title/xlabel/ylabel with NO `panel` key (fix round 3,
 *  J2 -- same ids/shape a flat response's title/xlabel/ylabel already use).
 *  Use `axesAt`/`panelAt` below to resolve a click/drag to the CONTAINING
 *  panel before converting pixels to data coordinates -- never read
 *  `panels[0]` (or the old `axes`) directly for a point that might land in
 *  a different panel. Full drag-EDIT semantics for a faceted preview
 *  (moving an annotation between panels, positioning a per-panel legend,
 *  etc.) are still NOT wired -- facets never draw an annotation/reference-
 *  line/shape into a panel at all (see `calc.figure_facets
 *  .render_facets_figure`'s own `overrides` doc), so there is nothing
 *  draggable to resolve for those; a per-panel LEGEND is real and hit-
 *  testable (fix round 4, P1) but stays INERT -- no per-panel position/
 *  title override exists yet to commit a drag into. Only hit-testing and
 *  coordinate mapping are guaranteed panel-correct today. */
export interface FigureHitmap {
  image: string; // base64 PNG
  width: number;
  height: number;
  elements: HitElement[];
  /** The flat (non-facet) path's single axes rect. Absent on a faceted
   *  response -- see `panels` instead. */
  axes?: AxesInfo;
  /** FU-facet-hitmap: one entry per facet panel. Absent on the flat path
   *  -- see `axes` instead. Exactly one of `axes`/`panels` is ever set. */
  panels?: PanelAxesInfo[];
}

/** The element under (px, py) — the SMALLEST hit box wins, so a series line
 *  crossing the legend doesn't shadow it. Null when nothing is hit. */
export function hitAt(
  elements: readonly HitElement[],
  px: number,
  py: number,
): HitElement | null {
  let best: HitElement | null = null;
  let bestArea = Infinity;
  for (const e of elements) {
    if (px < e.x0 || px > e.x1 || py < e.y0 || py > e.y1) continue;
    const area = (e.x1 - e.x0) * (e.y1 - e.y0);
    if (area < bestArea) {
      best = e;
      bestArea = area;
    }
  }
  return best;
}

const lerpAxis = (
  frac: number,
  lim: [number, number],
  scale: "linear" | "log" | "reciprocal",
): number => {
  if (scale === "log") {
    const [l0, l1] = [Math.log10(lim[0]), Math.log10(lim[1])];
    return 10 ** (l0 + frac * (l1 - l0));
  }
  if (scale === "reciprocal") {
    // Same affine-in-1/x formula uPlot's own custom scale uses (see
    // `uplotOpts.ts`'s `reciprocalTransform` doc) — self-inverse, so the
    // SAME function both derives the pixel fraction (fwd) and inverts it
    // back to a data value (bwd) here.
    const [r0, r1] = [reciprocalTransform(lim[0]), reciprocalTransform(lim[1])];
    return reciprocalTransform(r0 + frac * (r1 - r0));
  }
  return lim[0] + frac * (lim[1] - lim[0]);
};

/** Image pixels -> data coordinates (log/reciprocal-aware, MAIN #12). The y
 *  pixel axis points down, the data axis up — hence the flip. */
export function pxToData(axes: AxesInfo, px: number, py: number): { x: number; y: number } {
  const fx = (px - axes.x0) / (axes.x1 - axes.x0);
  const fy = (axes.y1 - py) / (axes.y1 - axes.y0);
  return {
    x: lerpAxis(fx, axes.xlim, axisScaleOf(axes.xscale, axes.xlog)),
    y: lerpAxis(fy, axes.ylim, axisScaleOf(axes.yscale, axes.ylog)),
  };
}

/** FU-facet-hitmap: which facet panel's axes rect CONTAINS (px, py) — the
 *  first step a faceted click/drag must take, before any pixel->data
 *  conversion, so a point in panel 3 is never interpreted against panel
 *  0's axes. Returns null for the flat path (`panels` absent/empty) or a
 *  point that lands in no panel's rect (the grid's gutters/margins, or the
 *  hidden trailing cells past the panel count). Panel rects don't overlap
 *  (`_grid_shape`'s row/col tiling), so at most one ever matches. */
export function panelAt(
  panels: readonly PanelAxesInfo[] | undefined,
  px: number,
  py: number,
): PanelAxesInfo | null {
  if (!panels) return null;
  for (const p of panels) {
    if (px >= p.x0 && px <= p.x1 && py >= p.y0 && py <= p.y1) return p;
  }
  return null;
}

/** The `AxesInfo` a pixel->data conversion at (px, py) must use: the
 *  CONTAINING facet panel's axes when `hitmap.panels` is set (`panelAt`
 *  above — resolved BEFORE converting, per-panel, never the flat path's
 *  `axes` nor panel 0 by default), else the flat path's own single
 *  `hitmap.axes`. Null when neither applies (a faceted point outside every
 *  panel, or a malformed/axes-less hitmap) — callers must treat that as
 *  "no target" rather than guessing an axes to fall back to. */
export function axesAt(hitmap: FigureHitmap, px: number, py: number): AxesInfo | null {
  if (hitmap.panels) return panelAt(hitmap.panels, px, py);
  return hitmap.axes ?? null;
}

/** Image pixels -> figure fraction (matplotlib transFigure coords: origin
 *  bottom-left) — what a custom legend anchor wants. */
export function pxToFigureFraction(
  width: number,
  height: number,
  px: number,
  py: number,
): [number, number] {
  return [
    Math.min(1, Math.max(0, px / width)),
    Math.min(1, Math.max(0, 1 - py / height)),
  ];
}

/** Image pixels -> canvas fraction (top-left origin, y-down): what a
 *  PAGE-anchored `Shape`'s x1/y1/x2/y2 store (`Shape.anchor === "page"`, see
 *  its doc in `lib/types.ts`) -- UNLIKE a page-anchored legend/annotation,
 *  which is a matplotlib figure fraction (`pxToFigureFraction` above,
 *  bottom-left origin, y-up). Image pixels already share the canvas's
 *  top-left/y-down origin (this module's header), so there's no flip to
 *  apply here -- the backend's own y-flip (`calc/figure_shapes.py`'s
 *  `1.0 - y1`) is what bridges canvas-fraction storage into matplotlib's
 *  transFigure space at render time.
 *
 *  Deliberately UNCLAMPED, unlike `pxToFigureFraction`: F2.4e's shape drag
 *  uses this only to take the DIFFERENCE of two calls (drop minus press
 *  origin), and clamping each endpoint first would distort that delta
 *  whenever the pointer strays outside the image mid-drag -- mirrors the
 *  Stage's own page-anchor drag (`uplotShapes.ts`'s shape-move handler),
 *  which computes the raw canvas-pixel delta before clamping the commit.
 *  Returns `{x, y}` (not a tuple, unlike `pxToFigureFraction`) so a caller
 *  can diff it against a `pxToData` result with the same shape. */
export function pxToCanvasFraction(width: number, height: number, px: number, py: number): { x: number; y: number } {
  return { x: px / width, y: py / height };
}

/** Which #11 property-panel group a hit element belongs to (click-to-focus).
 *
 *  `refline:`/`shape:` (F2.4c) route to the panels F2.3c/F2.3d added. Before
 *  the backend tagged those artists with a `gid`, both were drawn into the
 *  preview with no hit element at all — the F2.3c log entry records that as
 *  the reason its shapes panel got no context-menu wiring — so their panels
 *  were reachable only by hunting the collapsed group list. Group only, not
 *  the index: an element's index is the RENDER REQUEST's array position, i.e.
 *  the draft's list after the finite filter `viewOverrides` applies, so it is
 *  not safe to use as a draft index without re-deriving that filter. Opening
 *  the group is all the panels need; per-object focus would have to earn that
 *  mapping first. */
export function groupForElement(id: string): string | null {
  if (id === "legend") return "Legend";
  if (id.startsWith("ann:")) return "Annotations";
  if (id === "title" || id === "xlabel" || id === "ylabel") return "Text & fonts";
  if (id.startsWith("refline:")) return "Reference lines";
  if (id.startsWith("shape:")) return "Shapes";
  if (id.startsWith("series:")) return null; // per-series styles live on the plot side
  return null;
}
