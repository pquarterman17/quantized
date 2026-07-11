// Passive uPlot draw-overlays: decorations rendered from persistent app state
// (reference lines, annotations, the publication axis-box frame, error bars).
// Pixels are re-derived from data coords on every draw, so overlays stay pinned
// across zoom/pan. refLinePlugin is optionally interactive (drag to move a line);
// the rest are pure draw hooks. The active drag-gesture tools live in uplotTools.

import type uPlot from "uplot";

import type { ColorScatterSpec } from "./colorscatter";
import { colormap, normalize } from "./colormap";
import type { Annotation, RefLine, RegionShade } from "./types";

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

/** The leading `<n>px` in a CSS font shorthand (uplotOpts always builds one,
 *  e.g. `"11px monospace"`), or 11 when it can't be parsed — used to estimate
 *  a label's line height for the vertical clamp below (no canvas access
 *  needed, so it stays plain math). */
function fontPx(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? parseFloat(m[1]) : 11;
}

/** Where to draw one annotation's label text and which side to anchor it
 *  from, given the dot's already-clipped pixel x (`px`), the label's
 *  measured pixel width, the intended offset from the dot, and the plot
 *  area's horizontal bounds `[left, left + width]`.
 *
 *  Left-anchors at `px + offset` (the label sitting to the right of its dot,
 *  the normal case) unless that would run the label past the panel's right
 *  edge, in which case it flips to a right-anchor at `px - offset` (mirrored
 *  to the LEFT of the dot) — and if even that overflows the opposite edge
 *  (a label wider than the whole panel, or a dot pinned hard against one
 *  side), clamps the left-anchor position inward so the label's start stays
 *  on-panel rather than bleeding off it entirely.
 *
 *  Pure math, no canvas access — unit-testable without a 2D-context stub.
 *  Every mark drawn near a panel's left edge (any single-book figure's
 *  bottom-left-corner label, or every sub-panel of a multi-panel spread —
 *  each its own separately-canvased uPlot instance, so text spilling past
 *  ITS OWN left edge is simply invisible, not merely close to another
 *  panel's content) needs this: see `annotationPlugin`'s docstring for the
 *  root cause this replaces (an inherited `textAlign` that put the label
 *  BEHIND the dot instead of after it). */
export function clampAnnotationLabelX(
  px: number,
  textWidth: number,
  offset: number,
  left: number,
  width: number,
): { x: number; align: "left" | "right" } {
  const right = left + width;
  if (px + offset + textWidth <= right) return { x: px + offset, align: "left" };
  if (px - offset - textWidth >= left) return { x: px - offset, align: "right" };
  return { x: Math.max(left, Math.min(px + offset, right - textWidth)), align: "left" };
}

/** Draw text annotations (a small dot + label) pinned at data coordinates,
 *  clipped to the plot area so off-screen labels don't bleed into the axes.
 *  A mark tagged `axis: 1` (an Origin double-Y apply's upper-layer marks —
 *  see `originFigureAnnotations`) plots against the SECONDARY (y2) scale
 *  instead of the primary one, but only when this plot actually has a y2
 *  scale — a y2-tagged mark surviving onto a single-axis plot (e.g. after
 *  y2Keys was cleared) falls back to the primary scale rather than reading
 *  `u.scales.y2` as undefined.
 *
 *  `ctx.textAlign` is set explicitly on every draw (never left implicit):
 *  uPlot's own axis-label pass (`setFontStyle` in uPlot.esm.js) writes
 *  `textAlign`/`textBaseline` straight onto the shared canvas context with no
 *  save/restore, and never resets them before firing "draw" hooks — so
 *  whichever axis it drew LAST (typically the left Y-axis, which right-
 *  aligns its tick labels) leaves `textAlign: "right"` resident. An unset
 *  `textAlign` here silently inherited that, so `fillText(text, px + 6, …)`
 *  anchored the label's RIGHT edge at `px + 6` instead of its left — the
 *  label was drawn BEHIND its dot (extending leftward), not after it. For any
 *  mark sitting near a panel's left edge (Origin authors habitually pin these
 *  little curve labels bottom-left, and a multi-panel spread's per-layer
 *  marks are typically that same near-the-axis position in every panel) the
 *  label then ran into the y-axis title/tick-label gutter in a single plot,
 *  or clean off the edge of its own (separately canvased) panel in a
 *  multi-panel spread — invisible, not merely crowded. Confirmed against the
 *  live-COM oracle render of PNR.opj's `1p5mT`/`700mT` figures (Book15/
 *  Book14): the decoded mark position already matches where Origin itself
 *  puts the label (bottom-left, deliberately overlapping its own tick-label
 *  row) — the position was never wrong, only which direction the text grew
 *  from it. */
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
        const lineHeight = fontPx(font) * 1.3;
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
          if (a.text) {
            const textWidth = ctx.measureText(a.text).width;
            const { x: tx, align } = clampAnnotationLabelX(px, textWidth, 6, left, width);
            // Keep the label's top edge on-panel too — a mark near the very
            // top of the range would otherwise push a bottom-anchored line
            // above the plot area.
            const ty = Math.max(py - 2, top + lineHeight);
            ctx.textAlign = align;
            ctx.fillText(a.text, tx, ty);
          }
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
/** The fixed render alpha for Origin region shades: Origin's own
 *  fill-transparency field is UNDECODED (decode-plan #41 — no byte could be
 *  isolated across the corpus, see docs/origin_project_format.md §6.1), so
 *  this is a documented presentation choice — pale enough that data drawn
 *  over the band stays readable, matching Origin's pastel render. */
export const REGION_SHADE_ALPHA = 0.25;

/** Draw filled region rectangles (Origin `Rect*` bands — e.g. film-stack
 *  shading on an SLD profile, decode-plan #41) BEHIND the grid and data:
 *  the `drawClear` hook fires right after the canvas clears, before
 *  axes/grid/series paint over it — matching Origin, which draws these
 *  under everything. Extents are data coords re-derived on every draw
 *  (pinned across zoom/pan) and clipped to the plot area; a shade tagged
 *  `axis: 1` maps its y-extent through the y2 scale when the plot has one
 *  (same fallback rule as annotationPlugin). */
export function regionShadePlugin(shades: RegionShade[]): uPlot.Plugin {
  return {
    hooks: {
      drawClear: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const hasY2 = u.scales.y2 != null;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.globalAlpha = REGION_SHADE_ALPHA;
        for (const s of shades) {
          if (![s.x1, s.x2, s.y1, s.y2].every(Number.isFinite)) continue;
          const yScale = s.axis === 1 && hasY2 ? "y2" : "y";
          const xa = u.valToPos(s.x1, "x", true);
          const xb = u.valToPos(s.x2, "x", true);
          const ya = u.valToPos(s.y1, yScale, true);
          const yb = u.valToPos(s.y2, yScale, true);
          if (![xa, xb, ya, yb].every(Number.isFinite)) continue;
          ctx.fillStyle = s.fill;
          ctx.fillRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa), Math.abs(yb - ya));
        }
        ctx.restore();
      },
    },
  };
}

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

/** Default colour-mapped-scatter point diameter (CSS px) — matches the
 *  default marker size the regular per-series marker styling uses
 *  (`SeriesStyleCard`'s `NumberField` placeholder). */
const COLOR_SCATTER_SIZE = 5;

/** Draw colour-mapped scatter points (MAIN #14) for every series in `specs`
 *  (keyed by uPlot data-column index, 1-based — see `colorscatter.buildColorByColumns`):
 *  each point's fill colour comes from sampling that series' colormap at its
 *  own row's z value, normalized over the channel's full [lo, hi] range. The
 *  series' NATIVE line/points are hidden by the caller (`buildOpts`, which
 *  forces `width: 0, points: {show: false}` for any series with a colorBy
 *  entry) — this plugin is the ONLY thing that draws those points, the same
 *  "hide native, draw an overlay keyed to displayed x/y" pattern
 *  `errorBarsPlugin`/`annotationPlugin` use above. `z` may be longer than the
 *  plotted x (same convention as `errorBarsPlugin`'s `errsByCol` — extra tail
 *  entries are simply unused); a null/non-finite z at a row draws no point. */
export function colorScatterPlugin(specs: Map<number, ColorScatterSpec>): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        if (specs.size === 0) return;
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const xs = u.data[0];
        const r = COLOR_SCATTER_SIZE / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        for (const [col, spec] of specs) {
          const ys = u.data[col];
          if (!ys) continue;
          const scaleKey = u.series[col]?.scale ?? "y";
          for (let i = 0; i < xs.length; i++) {
            const x = xs[i];
            const y = ys[i];
            if (x == null || y == null) continue;
            const t = normalize(spec.z[i] ?? NaN, spec.lo, spec.hi, false);
            if (t == null) continue;
            const [rr, gg, bb] = colormap(spec.colormap, t);
            const px = u.valToPos(x, "x", true);
            const py = u.valToPos(y, scaleKey, true);
            ctx.beginPath();
            ctx.fillStyle = `rgb(${rr}, ${gg}, ${bb})`;
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      },
    },
  };
}
