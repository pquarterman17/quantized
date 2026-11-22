// Region-shade drawing and the off-scale reference-line marker — a LAZY
// chunk (eager-bundle budget). `lib/uplotOverlays.ts` keeps the eager plugin
// shells (`regionShadePlugin`, `refLinePlugin`) and starts loading this module
// the moment it loads — app startup, long before a plot can carry a shade —
// and every draw after that uses it; a draw in the brief window before it
// lands paints no shade/marker, and the next redraw does.
//
// Publication-figures audit #11: a shade inserted with the old default
// y1 = 0 .. y2 = 1 was invisible on a log axis (0 has no position, so the
// whole rect was skipped) and the export dropped it the same way. A
// `fullHeight` shade spans the plot height in AXES terms — what an x-range
// highlight almost always means — and is the default for a new shade; a
// data-y shade on a log/reciprocal axis with a side <= 0 runs from the plot
// floor instead of vanishing. `calc/figure_decor.py` applies the same rule
// to the export (and reports what it still cannot show). An off-scale
// reference line is named at the plot edge it lies beyond.

import type uPlot from "uplot";

import { pickRefLine, type RefLineHit } from "./refLineHit";
import { drawReferenceStick } from "./referenceStickOverlay";
import type { RefLine, RegionShade } from "./types";
import { REGION_SHADE_ALPHA } from "./uplotOverlays";
const MOVE = "mousemove", UP = "mouseup";

// The error-bar drawing rides this startup chunk too (lib/uplotErrorDraw.ts).
export { drawErrorBands, drawErrorBars, drawErrorSpans } from "./uplotErrorDraw";
export { drawColorScatter } from "./uplotScatterDraw"; // and the colour-mapped scatter
export { finishLoop, loopInk, strokeRows } from "./uplotLoopLine"; // and a non-monotonic-x line's stroke
export { peakMarkerEditPlugin } from "./peakMarkerHit"; // and the workshop click-to-edit plugins (peak markers, baseline anchors)
export { anchorEditPlugin } from "./uplotAnchors";

/** A shade's vertical extent in canvas px: the full plot height, or its y
 *  values on the shade's scale — a value with no position on a positive-only
 *  scale (log/reciprocal, y <= 0) reads as the plot floor. Null when nothing
 *  of it can be placed. */
function shadeYSpan(u: uPlot, s: RegionShade, yScale: string): [number, number] | null {
  const { top, height } = u.bbox;
  if (s.fullHeight) return [top, top + height];
  const floor = top + height;
  const ya = u.valToPos(s.y1, yScale, true);
  const yb = u.valToPos(s.y2, yScale, true);
  if (!Number.isFinite(ya) && !Number.isFinite(yb)) return null;
  return [Number.isFinite(ya) ? ya : floor, Number.isFinite(yb) ? yb : floor];
}

/** `regionShadePlugin`'s drawClear body (see that shell's doc in
 *  lib/uplotOverlays.ts for the z-order and axis rules). */
export function drawRegionShades(u: uPlot, shades: readonly RegionShade[]): void {
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const hasY2 = u.scales.y2 != null;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.globalAlpha = REGION_SHADE_ALPHA;
  for (const s of shades) {
    if (![s.x1, s.x2].every(Number.isFinite)) continue;
    if (!s.fullHeight && ![s.y1, s.y2].every(Number.isFinite)) continue;
    const yScale = s.axis === 1 && hasY2 ? "y2" : "y";
    // An x side with no position on this scale (<= 0 on log, 0 on
    // reciprocal) runs from the left edge, as the export does
    // (`calc.figure_decor._floored_span`); both sides missing draws nothing.
    const xa0 = u.valToPos(s.x1, "x", true);
    const xb0 = u.valToPos(s.x2, "x", true);
    if (!Number.isFinite(xa0) && !Number.isFinite(xb0)) continue;
    const xa = Number.isFinite(xa0) ? xa0 : left;
    const xb = Number.isFinite(xb0) ? xb0 : left;
    const ys = shadeYSpan(u, s, yScale);
    if (!ys) continue;
    const [ya, yb] = ys;
    ctx.fillStyle = s.fill;
    ctx.fillRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya));
  }
  ctx.restore();
}

/** A reference line whose value is off the current scale draws nothing, so
 *  mark it at the plot edge it lies beyond ("x = 12 ▸") instead of leaving
 *  the user to wonder where it went (audit #11). `side` is that edge. */
export function drawOffScaleRefLine(
  ctx: CanvasRenderingContext2D,
  ln: Pick<RefLine, "axis" | "label">,
  value: number,
  side: "low" | "high",
  bbox: { left: number; top: number; width: number; height: number },
): void {
  const name = ln.label || `${ln.axis} = ${Number(value.toPrecision(4))}`;
  ctx.save();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.85;
  if (ln.axis === "x") {
    const text = side === "low" ? `◂ ${name} (off-scale)` : `${name} (off-scale) ▸`;
    // Along the BOTTOM edge: the legend usually sits in a top corner and hid
    // a top-edge marker in the live check.
    ctx.textAlign = side === "low" ? "left" : "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(text, side === "low" ? bbox.left + 4 : bbox.left + bbox.width - 4, bbox.top + bbox.height - 4);
  } else {
    // Canvas y grows downward: a value above the scale ("high") sits at the
    // top. Left-aligned, away from a top-right legend.
    const text = `${side === "high" ? "▴" : "▾"} ${name} (off-scale)`;
    ctx.textAlign = "left";
    ctx.textBaseline = side === "high" ? "top" : "bottom";
    const y = side === "high" ? bbox.top + 4 : bbox.top + bbox.height - 4;
    ctx.fillText(text, bbox.left + 4, y);
  }
  ctx.restore();
}

/** Draw dashed reference lines at fixed X/Y values, clipped to the plot area.
 *  When `opts.interactive` and `opts.onMove` are given, lines become draggable:
 *  the pointer near a line shows a resize cursor and a drag moves it. The live
 *  position is held plugin-locally (canvas redraw only) and committed to the
 *  store once on release — so the plot isn't rebuilt on every mouse move. */
export function refLinePlugin(
  lines: RefLine[],
  color: string,
  opts?: { onMove?: (id: string, value: number) => void; interactive?: boolean; font?: string },
): uPlot.Plugin {
  // Live override for the line being dragged (null = nothing dragging).
  let dragId: string | null = null;
  let dragValue = 0;

  return {
    hooks: {
      ready:
        opts?.interactive && opts.onMove
          ? (u: uPlot) => {
              const over = u.over;
              const onMove = opts.onMove!;
              // The line's pixel in *plot-area* space (canvasPixels=false), to
              // match pointer coords measured from over's top-left.
              const hit = (clientX: number, clientY: number): RefLineHit | null => {
                const rect = over.getBoundingClientRect();
                // A reference stick is only a short mark at the bottom of the
                // plot, but pickRefLine's X-line contract intentionally spans
                // the full plot height. Feeding a dense stick pattern into it
                // would therefore steal zoom/cursor gestures almost
                // everywhere. Pattern positions stay fixed; group styling is
                // edited in the Reference lines Inspector instead.
                const cands = lines.filter((ln) => !ln.stick).map((ln) => ({
                  id: ln.id,
                  axis: ln.axis,
                  px: u.valToPos(ln.value, ln.axis === "x" ? "x" : "y"),
                }));
                return pickRefLine(cands, { x: clientX - rect.left, y: clientY - rect.top });
              };

              over.addEventListener(MOVE, (e: MouseEvent) => {
                if (dragId) return; // cursor managed during drag
                const h = hit(e.clientX, e.clientY);
                over.style.cursor = h ? (h.axis === "x" ? "ew-resize" : "ns-resize") : "";
              });

              over.addEventListener(
                "mousedown",
                (e: MouseEvent) => {
                  if (e.button !== 0) return;
                  const h = hit(e.clientX, e.clientY);
                  if (!h) return; // not on a line → let uPlot box-zoom proceed
                  e.preventDefault();
                  e.stopPropagation(); // capture-phase: beat uPlot's drag handler
                  const rect = over.getBoundingClientRect();
                  const valAt = (ev: MouseEvent) =>
                    h.axis === "x"
                      ? u.posToVal(ev.clientX - rect.left, "x")
                      : u.posToVal(ev.clientY - rect.top, "y");
                  dragId = h.id;
                  dragValue = lines.find((l) => l.id === h.id)?.value ?? valAt(e);

                  const move = (ev: MouseEvent) => {
                    dragValue = valAt(ev);
                    u.redraw();
                  };
                  const up = (ev: MouseEvent) => {
                    const v = valAt(ev);
                    document.removeEventListener(MOVE, move);
                    document.removeEventListener(UP, up);
                    dragId = null;
                    over.style.cursor = "";
                    onMove(h.id, v); // commit once
                  };
                  document.addEventListener(MOVE, move);
                  document.addEventListener(UP, up);
                },
                { capture: true },
              );
            }
          : undefined,
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.fillStyle = ctx.strokeStyle = color;
        ctx.font = opts?.font ?? ctx.font;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        const lineHeight = parseFloat(ctx.font) * 1.25;
        let labelRight = -Infinity;
        let labelRow = 0;
        for (const ln of lines) {
          // Use the live drag value for the line under the cursor.
          const value = ln.id === dragId ? dragValue : ln.value;
          if (!Number.isFinite(value)) continue;
          ctx.beginPath();
          if (ln.axis === "x") {
            const px = u.valToPos(value, "x", true);
            if (px < left || px > left + width) {
              if (!ln.stick) drawOffScaleRefLine(ctx, ln, value, px < left ? "low" : "high", u.bbox);
              continue;
            }
            if (ln.stick) {
              if (!drawReferenceStick(ctx, ln, px, top, height)) continue;
            } else {
              ctx.strokeStyle = ctx.fillStyle = color;
              ctx.setLineDash([5, 4]);
              ctx.moveTo(px, top);
              ctx.lineTo(px, top + height);
            }
            if (!ln.stick && ln.label) {
              labelRow = px < labelRight ? labelRow + 1 : 0;
              const y = top + (labelRow + 1) * lineHeight;
              if (y <= top + height) ctx.fillText(ln.label, px + 3, y);
              labelRight = Math.max(labelRight, px + ctx.measureText(ln.label).width + 3);
            }
          } else {
            ctx.strokeStyle = ctx.fillStyle = color;
            ctx.setLineDash([5, 4]);
            const py = u.valToPos(value, "y", true);
            if (py < top || py > top + height || !Number.isFinite(py)) {
              drawOffScaleRefLine(ctx, ln, value, py < top ? "high" : "low", u.bbox);
              continue;
            }
            ctx.moveTo(left, py);
            ctx.lineTo(left + width, py);
            if (ln.label) ctx.fillText(ln.label, left + 4, py - 3);
          }
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}
