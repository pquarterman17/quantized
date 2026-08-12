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

/** Resolve the effective axis scale for `pxToData`'s inversion: the new
 *  `xscale`/`yscale` field wins when present; else the old `xlog`/`ylog`
 *  boolean maps to "log"/"linear" (mirrors `lib/plotview.ts`'s
 *  `scaleFromLog`, duplicated here to keep this module free of a
 *  store/plotview dependency — it's a pure geometry module). */
function axisScaleOf(scale: "linear" | "log" | "reciprocal" | undefined, log: boolean): "linear" | "log" | "reciprocal" {
  return scale ?? (log ? "log" : "linear");
}

export interface FigureHitmap {
  image: string; // base64 PNG
  width: number;
  height: number;
  elements: HitElement[];
  axes: AxesInfo;
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
