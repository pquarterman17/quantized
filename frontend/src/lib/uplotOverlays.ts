// Passive uPlot draw-overlays: decorations rendered from persistent app state
// (reference lines, annotations, the publication axis-box frame, error bars).
// Pixels are re-derived from data coords on every draw, so overlays stay pinned
// across zoom/pan. refLinePlugin is optionally interactive (drag to move a line);
// the rest are pure draw hooks. The active drag-gesture tools live in uplotTools.

import type uPlot from "uplot";

import type { Annotation, RefLine } from "./types";

/** A reference line the pointer is over (for drag hit-testing). */
export interface RefLineHit {
  id: string;
  axis: "x" | "y";
}

/** Pick the reference line nearest the pointer within `tol` px, or null. Each
 *  candidate carries its on-axis pixel: x-lines are vertical (compare pointer.x),
 *  y-lines horizontal (compare pointer.y). Ties resolve to the closest. */
export function pickRefLine(
  candidates: { id: string; axis: "x" | "y"; px: number }[],
  pointer: { x: number; y: number },
  tol = 6,
): RefLineHit | null {
  let best: RefLineHit | null = null;
  let bestDist = tol;
  for (const c of candidates) {
    if (!Number.isFinite(c.px)) continue;
    const d = Math.abs((c.axis === "x" ? pointer.x : pointer.y) - c.px);
    if (d <= bestDist) {
      bestDist = d;
      best = { id: c.id, axis: c.axis };
    }
  }
  return best;
}

/** Draw dashed reference lines at fixed X/Y values, clipped to the plot area.
 *  When `opts.interactive` and `opts.onMove` are given, lines become draggable:
 *  the pointer near a line shows a resize cursor and a drag moves it. The live
 *  position is held plugin-locally (canvas redraw only) and committed to the
 *  store once on release — so the plot isn't rebuilt on every mouse move. */
export function refLinePlugin(
  lines: RefLine[],
  color: string,
  opts?: { onMove?: (id: string, value: number) => void; interactive?: boolean },
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
                const cands = lines.map((ln) => ({
                  id: ln.id,
                  axis: ln.axis,
                  px: u.valToPos(ln.value, ln.axis === "x" ? "x" : "y"),
                }));
                return pickRefLine(cands, { x: clientX - rect.left, y: clientY - rect.top });
              };

              over.addEventListener("mousemove", (e: MouseEvent) => {
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
                    document.removeEventListener("mousemove", move);
                    document.removeEventListener("mouseup", up);
                    dragId = null;
                    over.style.cursor = "";
                    onMove(h.id, v); // commit once
                  };
                  document.addEventListener("mousemove", move);
                  document.addEventListener("mouseup", up);
                },
                { capture: true },
              );
            }
          : undefined,
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        for (const ln of lines) {
          // Use the live drag value for the line under the cursor.
          const value = ln.id === dragId ? dragValue : ln.value;
          if (!Number.isFinite(value)) continue;
          ctx.beginPath();
          if (ln.axis === "x") {
            const px = u.valToPos(value, "x", true);
            if (px < left || px > left + width) continue;
            ctx.moveTo(px, top);
            ctx.lineTo(px, top + height);
          } else {
            const py = u.valToPos(value, "y", true);
            if (py < top || py > top + height) continue;
            ctx.moveTo(left, py);
            ctx.lineTo(left + width, py);
          }
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}

/** Draw a full rectangular frame around the plot area (the "axis box" look that
 *  publications favour, esp. with the grid off). uPlot's per-axis border only
 *  gives an L; this strokes all four sides of u.bbox. (#17) */
export function axisBoxPlugin(color: string): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
        ctx.restore();
      },
    },
  };
}

/** Draw text annotations (a small dot + label) pinned at data coordinates,
 *  clipped to the plot area so off-screen labels don't bleed into the axes.
 *  A mark tagged `axis: 1` (an Origin double-Y apply's upper-layer marks —
 *  see `originFigureAnnotations`) plots against the SECONDARY (y2) scale
 *  instead of the primary one, but only when this plot actually has a y2
 *  scale — a y2-tagged mark surviving onto a single-axis plot (e.g. after
 *  y2Keys was cleared) falls back to the primary scale rather than reading
 *  `u.scales.y2` as undefined. */
export function annotationPlugin(
  annotations: Annotation[],
  color: string,
  font: string,
): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const hasY2 = u.scales.y2 != null;
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = font;
        ctx.textBaseline = "bottom";
        for (const a of annotations) {
          if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
          const yScale = a.axis === 1 && hasY2 ? "y2" : "y";
          const px = u.valToPos(a.x, "x", true);
          const py = u.valToPos(a.y, yScale, true);
          if (px < left || px > left + width || py < top || py > top + height) continue;
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fill();
          if (a.text) ctx.fillText(a.text, px + 6, py - 2);
        }
        ctx.restore();
      },
    },
  };
}

/** Draw vertical error-bar whiskers (y ± e) for selected data columns, with
 *  optional end caps. `errorsByCol` is keyed by uPlot data-column index
 *  (1-based); each value is the per-point error magnitude (null = no bar
 *  there). Each column's whiskers use that series' own y scale (primary or
 *  secondary). Clipped to the plot area so off-range whiskers don't bleed
 *  into the axes.
 *
 *  `capHalfWidth` (CSS px) defaults to 0 — bars only, no cross-stroke caps
 *  (owner 2026-07-09, item 3: "default is have the error bar cap width to
 *  zero"). The drawing still fully supports non-zero caps for a caller that
 *  opts in (e.g. a future per-plot preference) — only the DEFAULT changed. */
export function errorBarsPlugin(
  errorsByCol: Map<number, (number | null)[]>,
  color: string,
  capHalfWidth = 0,
): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const xs = u.data[0];
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        for (const [col, errs] of errorsByCol) {
          const ys = u.data[col];
          if (!ys) continue;
          const scaleKey = u.series[col]?.scale ?? "y";
          for (let i = 0; i < xs.length; i++) {
            const x = xs[i];
            const y = ys[i];
            const e = errs[i];
            if (x == null || y == null || e == null) continue;
            const px = u.valToPos(x, "x", true);
            const pHi = u.valToPos(y + e, scaleKey, true);
            const pLo = u.valToPos(y - e, scaleKey, true);
            ctx.beginPath();
            ctx.moveTo(px, pLo);
            ctx.lineTo(px, pHi);
            if (capHalfWidth > 0) {
              ctx.moveTo(px - capHalfWidth, pHi);
              ctx.lineTo(px + capHalfWidth, pHi);
              ctx.moveTo(px - capHalfWidth, pLo);
              ctx.lineTo(px + capHalfWidth, pLo);
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      },
    },
  };
}
