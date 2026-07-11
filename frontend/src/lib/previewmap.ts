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

/** Which #11 property-panel group a hit element belongs to (click-to-focus). */
export function groupForElement(id: string): string | null {
  if (id === "legend") return "Legend";
  if (id.startsWith("ann:")) return "Annotations";
  if (id === "title" || id === "xlabel" || id === "ylabel") return "Text & fonts";
  if (id.startsWith("series:")) return null; // per-series styles live on the plot side
  return null;
}
