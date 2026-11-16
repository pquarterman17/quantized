// UX-A: what a Pointer-tool click on the plot selects, and the geometry of the
// selection highlight drawn for it. Pure over a live uPlot (or a stand-in with
// the same few members), so both halves are unit-tested without a canvas.
// Loaded only with the lazy PlotSelectionLayer.

import type uPlot from "uplot";

import { axisZoneAt } from "../../lib/plotHitTest";
import type { PlotSelection } from "../../store/plotSelection";
import { hitTest } from "./curveHit";
import { OBJECT_CURSORS } from "./usePlotStageActions";

/** How close (CSS px, vertically at the nearest row) a click must land to a
 *  curve to select it — the curve double-click's own tolerance. */
export const CURVE_PICK_PX = 12;
/** Most points a curve halo draws; longer curves are strided. */
const HALO_MAX_POINTS = 4000;

/** The selection for a click at client (x, y) on `target`: a curve, an axis,
 *  the legend, null (empty plot area: clear), or undefined when the click
 *  belongs to something else (an annotation / shape / reference line, the
 *  toolbar, a title) and the selection must stay as it is. */
export function pickAt(
  u: uPlot,
  target: Element,
  x: number,
  y: number,
  plotted: readonly number[],
  hasY2: boolean,
): PlotSelection | null | undefined {
  if (target.closest(".qzk-legend")) return { kind: "legend" };
  if (u.over.contains(target)) {
    // An object plugin shows a move / resize cursor over what it owns, and
    // already selected it on mousedown.
    if (OBJECT_CURSORS.has(u.over.style.cursor)) return undefined;
    const hidden = plotted.map((_, i) => u.series[i + 1]?.show === false);
    const { series } = hitTest(u, x, y, plotted, hidden, false, CURVE_PICK_PX);
    const channel = series != null ? plotted[series] : undefined;
    return channel !== undefined ? { kind: "series", channel } : null;
  }
  if (!u.root.contains(target)) return undefined;
  // The axis band beside the plot area (the double-click's own zones).
  const zone = axisZoneAt(x, y, u.over.getBoundingClientRect(), hasY2);
  return zone === "x" || zone === "y" || zone === "y2" ? { kind: "axis", axis: zone } : undefined;
}

export interface HaloGeometry {
  /** SVG path in STAGE coordinates (a curve), or "" for none. */
  d: string;
  /** Stroke width (CSS px) of the curve halo. */
  width: number;
  /** A rectangle in stage coordinates (an axis band or the legend box). */
  box: { x: number; y: number; w: number; h: number } | null;
}

type Rect = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;

/** The highlight for `sel`, relative to `stage` (the element the halo SVG
 *  fills). A curve gets a wide translucent stroke along its drawn points
 *  (round dots for a markers-only series); an axis its band beside the plot
 *  area; the legend its own box. */
export function haloGeometry(
  u: uPlot,
  stage: Element,
  sel: PlotSelection,
  plotted: readonly number[],
): HaloGeometry {
  const s: Rect = stage.getBoundingClientRect();
  const o: Rect = u.over.getBoundingClientRect();
  const none: HaloGeometry = { d: "", width: 0, box: null };
  if (sel.kind === "legend") {
    const el = stage.querySelector(".qzk-legend");
    if (!el) return none;
    const r = el.getBoundingClientRect();
    return { ...none, box: { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height } };
  }
  if (sel.kind === "axis") {
    const r: Rect = u.root.getBoundingClientRect();
    const box =
      sel.axis === "x"
        ? { x: o.left, y: o.bottom, w: o.width, h: r.bottom - o.bottom }
        : sel.axis === "y"
          ? { x: r.left, y: o.top, w: o.left - r.left, h: o.height }
          : { x: o.right, y: o.top, w: r.right - o.right, h: o.height };
    return { ...none, box: { ...box, x: box.x - s.left, y: box.y - s.top } };
  }
  const i = plotted.indexOf(sel.channel);
  const ser = u.series[i + 1];
  if (i < 0 || !ser || ser.show === false) return none;
  const xs = (u.data[0] ?? []) as (number | null)[];
  const ys = (u.data[i + 1] ?? []) as (number | null)[];
  const ox = o.left - s.left;
  const oy = o.top - s.top;
  const dots = ser.width === 0;
  const stride = Math.max(1, Math.ceil(xs.length / HALO_MAX_POINTS));
  const parts: string[] = [];
  let pen = false;
  for (let r = 0; r < xs.length; r += stride) {
    const xv = xs[r];
    const yv = ys[r];
    if (xv == null || yv == null || !Number.isFinite(xv) || !Number.isFinite(yv)) {
      pen = false;
      continue;
    }
    const px = (u.valToPos(xv, "x", false) + ox).toFixed(1);
    const py = (u.valToPos(yv, ser.scale ?? "y", false) + oy).toFixed(1);
    parts.push(dots ? `M${px},${py}h0` : `${pen ? "L" : "M"}${px},${py}`);
    pen = true;
  }
  const lineW = typeof ser.width === "number" && ser.width > 0 ? ser.width : 1.5;
  return { d: parts.join(""), width: dots ? 12 : lineW + 6, box: null };
}
