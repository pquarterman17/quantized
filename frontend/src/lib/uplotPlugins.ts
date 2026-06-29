// uPlot plugins for the plot tool-dock: drag-to-pan and a cursor readout.

import type uPlot from "uplot";

import { trapz } from "./integrate";
import { computeMeasurement, type Measurement } from "./measure";
import { fwhm, type FwhmResult } from "./peakwidth";
import { computeRegionStats, type RegionStats } from "./regionStats";
import type { Annotation, RefLine } from "./types";

/** Index of the first *visible* y data column (skips legend-hidden series), or 0
 *  if the plot has no series. The integrate/FWHM tools operate on this series —
 *  the topmost plotted trace, matching the "first visible" rule in the handoff. */
function firstVisibleCol(u: uPlot): number {
  for (let s = 1; s < u.series.length; s++) {
    if (u.series[s]?.show !== false) return s;
  }
  return u.series.length > 1 ? 1 : 0;
}

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

/** Draw text annotations (a small dot + label) pinned at data coordinates,
 *  clipped to the plot area so off-screen labels don't bleed into the axes. */
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
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = font;
        ctx.textBaseline = "bottom";
        for (const a of annotations) {
          if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
          const px = u.valToPos(a.x, "x", true);
          const py = u.valToPos(a.y, "y", true);
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

/** Draw vertical error-bar whiskers (y ± e) with end caps for selected data
 *  columns. `errorsByCol` is keyed by uPlot data-column index (1-based); each
 *  value is the per-point error magnitude (null = no bar there). Each column's
 *  whiskers use that series' own y scale (primary or secondary). Clipped to the
 *  plot area so off-range whiskers don't bleed into the axes. */
export function errorBarsPlugin(
  errorsByCol: Map<number, (number | null)[]>,
  color: string,
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
            ctx.moveTo(px - 3, pHi);
            ctx.lineTo(px + 3, pHi);
            ctx.moveTo(px - 3, pLo);
            ctx.lineTo(px + 3, pLo);
            ctx.stroke();
          }
        }
        ctx.restore();
      },
    },
  };
}

/** One series' value at the cursor index. */
export interface ReadoutRow {
  label: string;
  y: number;
}

/** Readout reported by the cursor plugin (null when off-data): the cursor x plus
 *  every *visible* series' y at that shared aligned-data index (a mini tooltip). */
export interface Readout {
  x: number;
  rows: ReadoutRow[];
}

/**
 * Drag-to-pan: shifts both scales by the pointer delta (linear mapping over the
 * plotting area). Document-level move/up listeners are bound per drag and torn
 * down on release, so destroyed plots leave nothing behind.
 */
export function panPlugin(): uPlot.Plugin {
  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        over.style.cursor = "grab";
        over.addEventListener("mousedown", (e: MouseEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
          over.style.cursor = "grabbing";
          const startX = e.clientX;
          const startY = e.clientY;
          const x0min = u.scales.x.min ?? 0;
          const x0max = u.scales.x.max ?? 1;
          const y0min = u.scales.y.min ?? 0;
          const y0max = u.scales.y.max ?? 1;

          const onMove = (ev: MouseEvent) => {
            const w = over.clientWidth || 1;
            const h = over.clientHeight || 1;
            const dx = ((ev.clientX - startX) / w) * (x0max - x0min);
            const dy = ((ev.clientY - startY) / h) * (y0max - y0min);
            u.setScale("x", { min: x0min - dx, max: x0max - dx });
            u.setScale("y", { min: y0min + dy, max: y0max + dy });
          };
          const onUp = () => {
            over.style.cursor = "grab";
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
      },
    },
  };
}

/**
 * Two-point measurement ruler: drag from A to B over the plot; reports Δx / Δy /
 * slope (in data units) and draws a dashed segment with endpoint dots. The
 * endpoints are kept in DATA coords so the ruler stays pinned to the data as the
 * view zooms/pans (pixels are re-derived each draw via valToPos). Per-drag
 * move/up listeners are torn down on release, mirroring panPlugin.
 */
export function measurePlugin(
  onMeasure: (m: Measurement | null) => void,
  color: string,
): uPlot.Plugin {
  // Live segment in DATA coordinates (null = nothing measured yet).
  let seg: Measurement | null = null;

  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        over.style.cursor = "crosshair";
        over.addEventListener("mousedown", (e: MouseEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const rect = over.getBoundingClientRect();
          const x0 = u.posToVal(e.clientX - rect.left, "x");
          const y0 = u.posToVal(e.clientY - rect.top, "y");
          seg = computeMeasurement(x0, y0, x0, y0);
          onMeasure(seg);
          u.redraw();

          const onMove = (ev: MouseEvent) => {
            const x1 = u.posToVal(ev.clientX - rect.left, "x");
            const y1 = u.posToVal(ev.clientY - rect.top, "y");
            seg = computeMeasurement(x0, y0, x1, y1);
            onMeasure(seg);
            u.redraw();
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
      },
      draw: (u: uPlot) => {
        if (!seg) return;
        const ax = u.valToPos(seg.x0, "x", true);
        const ay = u.valToPos(seg.y0, "y", true);
        const bx = u.valToPos(seg.x1, "x", true);
        const by = u.valToPos(seg.y1, "y", true);
        const { ctx } = u;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [px, py] of [
          [ax, ay],
          [bx, by],
        ]) {
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      },
    },
  };
}

/**
 * Region statistics: drag an x-band over the plot (crosshair cursor) and report
 * per-series summary stats (n / mean / std / median / min / max) over the points
 * whose x falls in the band — live during the drag. The band is held in DATA
 * x-coords so the shaded selection stays pinned across zoom/pan; pixels are
 * re-derived each draw. Per-drag listeners are torn down on release (like
 * measurePlugin). Stats use the series' own labels + visibility (legend-hidden
 * series are excluded).
 */
export function statsPlugin(
  onStats: (s: RegionStats | null) => void,
  color: string,
): uPlot.Plugin {
  // Live band in DATA x-coords (null = nothing selected yet).
  let band: { x0: number; x1: number } | null = null;

  const recompute = (u: uPlot): void => {
    if (!band) {
      onStats(null);
      return;
    }
    const labels: string[] = [];
    const visible: boolean[] = [];
    for (let s = 1; s < u.series.length; s++) {
      const lbl = u.series[s]?.label;
      labels.push(typeof lbl === "string" ? lbl : `series ${s}`);
      visible.push(u.series[s]?.show !== false);
    }
    const data = u.data as unknown as (number | null)[][];
    onStats(computeRegionStats(data, labels, band.x0, band.x1, visible));
  };

  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        over.style.cursor = "crosshair";
        over.addEventListener("mousedown", (e: MouseEvent) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const rect = over.getBoundingClientRect();
          const x0 = u.posToVal(e.clientX - rect.left, "x");
          band = { x0, x1: x0 };
          recompute(u);
          u.redraw();
          const onMove = (ev: MouseEvent) => {
            band = { x0, x1: u.posToVal(ev.clientX - rect.left, "x") };
            recompute(u);
            u.redraw();
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
      },
      draw: (u: uPlot) => {
        if (!band) return;
        const { ctx } = u;
        const { top, height } = u.bbox;
        const ax = u.valToPos(band.x0, "x", true);
        const bx = u.valToPos(band.x1, "x", true);
        const x = Math.min(ax, bx);
        const w = Math.abs(bx - ax);
        if (w < 1) return;
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.12;
        ctx.fillRect(x, top, w, height);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(ax, top);
        ctx.lineTo(ax, top + height);
        ctx.moveTo(bx, top);
        ctx.lineTo(bx, top + height);
        ctx.stroke();
        ctx.restore();
      },
    },
  };
}

/**
 * Wheel-to-zoom toward the cursor (Preferences ▸ Interaction ▸ Mouse wheel).
 * Wheel up zooms in, down zooms out, by `step` per notch (default 1.18). `⌘`/Ctrl
 * = X-only, `⇧` = Y-only. The new range is read back through `posToVal`, so the
 * zoom is correct for log axes (distr:3) as well as linear. The listener is bound
 * to `u.over`, which uPlot tears down on destroy.
 */
export function wheelZoomPlugin(step = 1.18): uPlot.Plugin {
  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        over.addEventListener(
          "wheel",
          (e: WheelEvent) => {
            if (e.deltaY === 0) return;
            e.preventDefault();
            const rect = over.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const wid = over.clientWidth || 1;
            const hgt = over.clientHeight || 1;
            const f = e.deltaY < 0 ? 1 / step : step; // up → zoom in (shrink range)
            const onlyX = e.metaKey || e.ctrlKey;
            const onlyY = e.shiftKey;
            if (!onlyY) {
              // New left/right edges in OLD pixel space, scaled about the cursor,
              // mapped back to data values (posToVal handles linear + log x).
              const a = u.posToVal(cx - cx * f, "x");
              const b = u.posToVal(cx + (wid - cx) * f, "x");
              u.setScale("x", { min: Math.min(a, b), max: Math.max(a, b) });
            }
            if (!onlyX) {
              const a = u.posToVal(cy - cy * f, "y");
              const b = u.posToVal(cy + (hgt - cy) * f, "y");
              u.setScale("y", { min: Math.min(a, b), max: Math.max(a, b) });
            }
          },
          { passive: false },
        );
      },
    },
  };
}

/** Report every visible series' value at the nearest-x cursor index (or null when
 *  off-plot / no visible series have a value there). The cursor index is shared
 *  across the aligned data, so one lookup per column gives a full readout. */
export function readoutPlugin(onReadout: (r: Readout | null) => void): uPlot.Plugin {
  return {
    hooks: {
      setCursor: (u: uPlot) => {
        const idx = u.cursor.idx;
        if (idx == null) {
          onReadout(null);
          return;
        }
        const x = u.data[0][idx];
        if (x == null) {
          onReadout(null);
          return;
        }
        const rows: ReadoutRow[] = [];
        for (let s = 1; s < u.data.length; s++) {
          if (u.series[s]?.show === false) continue; // skip hidden (legend) series
          const y = u.data[s]?.[idx];
          if (y == null) continue;
          const lbl = u.series[s]?.label;
          rows.push({ label: typeof lbl === "string" ? lbl : "", y });
        }
        if (rows.length === 0) {
          onReadout(null);
          return;
        }
        onReadout({ x, rows });
      },
    },
  };
}

/**
 * Integrate (∫): drag an x-band over the first visible series; live-shade the
 * area under the trace down to the bottom axis plus a boundary line at each edge,
 * and on release report the trapezoidal integral over the band (interpolated at
 * the bounds — see lib/integrate.trapz). A committed `result` keeps the shaded
 * region drawn after release (re-derived from data coords each draw, so it stays
 * pinned across zoom/pan) until cleared or the dataset changes. The band is held
 * plugin-locally during the drag (canvas redraw only); per-drag listeners tear
 * down on release, like statsPlugin. A drag under ~6 px is treated as a click.
 */
export function integratePlugin(
  result: { xlo: number; xhi: number } | null,
  color: string,
  fill: string,
  opts?: {
    onIntegrate?: (r: { xlo: number; xhi: number; area: number }) => void;
    interactive?: boolean;
  },
): uPlot.Plugin {
  // Live band in DATA x-coords while dragging (null = not dragging).
  let band: { x0: number; x1: number } | null = null;

  return {
    hooks: {
      ready:
        opts?.interactive && opts.onIntegrate
          ? (u: uPlot) => {
              const over = u.over;
              over.style.cursor = "crosshair";
              const onIntegrate = opts.onIntegrate!;
              over.addEventListener("mousedown", (e: MouseEvent) => {
                if (e.button !== 0) return;
                e.preventDefault();
                const rect = over.getBoundingClientRect();
                const x0 = u.posToVal(e.clientX - rect.left, "x");
                band = { x0, x1: x0 };
                u.redraw();
                const onMove = (ev: MouseEvent) => {
                  band = { x0, x1: u.posToVal(ev.clientX - rect.left, "x") };
                  u.redraw();
                };
                const onUp = (ev: MouseEvent) => {
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                  const x1 = u.posToVal(ev.clientX - rect.left, "x");
                  band = null;
                  const dpx = Math.abs(
                    u.valToPos(x1, "x", true) - u.valToPos(x0, "x", true),
                  );
                  const col = firstVisibleCol(u);
                  const xs = u.data[0] as (number | null)[];
                  const ys = (col ? u.data[col] : null) as (number | null)[] | null;
                  if (!ys || dpx < 6) {
                    u.redraw(); // a click, not a region
                    return;
                  }
                  onIntegrate({
                    xlo: Math.min(x0, x1),
                    xhi: Math.max(x0, x1),
                    area: trapz(xs, ys, x0, x1),
                  });
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              });
            }
          : undefined,
      draw: (u: uPlot) => {
        const b = band ?? (result ? { x0: result.xlo, x1: result.xhi } : null);
        if (!b) return;
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const baseY = top + height;
        const lo = Math.min(b.x0, b.x1);
        const hi = Math.max(b.x0, b.x1);
        const col = firstVisibleCol(u);
        const xs = u.data[0] as (number | null)[];
        const ys = (col ? u.data[col] : null) as (number | null)[] | null;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        // Filled area under the trace within [lo,hi] (polygon through in-range
        // samples, closed along the bottom axis). Illustrative — the reported
        // area comes from trapz, which interpolates the exact bounds.
        if (ys) {
          const scale = u.series[col]?.scale ?? "y";
          const pts: [number, number][] = [];
          for (let i = 0; i < xs.length; i++) {
            const xv = xs[i];
            const yv = ys[i];
            if (xv == null || yv == null || !Number.isFinite(xv) || !Number.isFinite(yv)) continue;
            if (xv < lo || xv > hi) continue;
            pts.push([u.valToPos(xv, "x", true), u.valToPos(yv, scale, true)]);
          }
          if (pts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], baseY);
            for (const [px, py] of pts) ctx.lineTo(px, py);
            ctx.lineTo(pts[pts.length - 1][0], baseY);
            ctx.closePath();
            ctx.fillStyle = fill;
            ctx.fill();
          }
        }
        // Boundary verticals at the exact bounds.
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.8;
        for (const xv of [lo, hi]) {
          const px = u.valToPos(xv, "x", true);
          if (px < left || px > left + width) continue;
          ctx.beginPath();
          ctx.moveTo(px, top);
          ctx.lineTo(px, baseY);
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}

/**
 * Peak / FWHM (∩): drag an x-band; live-shade a faint full-height band, and on
 * release estimate the peak center + full-width-half-max within it (lib/peakwidth
 * .fwhm — the quick on-plot estimator). A committed `result` draws a dashed
 * center line (apex→axis), a solid half-max crossbar (x1→x2) with end caps, and
 * an apex dot; it re-derives pixels from data coords each draw so it stays pinned
 * across zoom/pan. Per-drag listeners tear down on release; a sub-6 px drag is a
 * click (no-op).
 */
export function fwhmPlugin(
  result: FwhmResult | null,
  color: string,
  bandColor: string,
  opts?: { onFwhm?: (r: FwhmResult) => void; interactive?: boolean },
): uPlot.Plugin {
  // Live band in DATA x-coords while dragging (null = not dragging).
  let band: { x0: number; x1: number } | null = null;

  return {
    hooks: {
      ready:
        opts?.interactive && opts.onFwhm
          ? (u: uPlot) => {
              const over = u.over;
              over.style.cursor = "crosshair";
              const onFwhm = opts.onFwhm!;
              over.addEventListener("mousedown", (e: MouseEvent) => {
                if (e.button !== 0) return;
                e.preventDefault();
                const rect = over.getBoundingClientRect();
                const x0 = u.posToVal(e.clientX - rect.left, "x");
                band = { x0, x1: x0 };
                u.redraw();
                const onMove = (ev: MouseEvent) => {
                  band = { x0, x1: u.posToVal(ev.clientX - rect.left, "x") };
                  u.redraw();
                };
                const onUp = (ev: MouseEvent) => {
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                  const x1 = u.posToVal(ev.clientX - rect.left, "x");
                  band = null;
                  const dpx = Math.abs(
                    u.valToPos(x1, "x", true) - u.valToPos(x0, "x", true),
                  );
                  const col = firstVisibleCol(u);
                  const xs = u.data[0] as (number | null)[];
                  const ys = (col ? u.data[col] : null) as (number | null)[] | null;
                  const r = ys && dpx >= 6 ? fwhm(xs, ys, x0, x1) : null;
                  if (r) onFwhm(r);
                  else u.redraw();
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              });
            }
          : undefined,
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const baseY = top + height;
        // Live candidate band while dragging.
        if (band) {
          const ax = u.valToPos(band.x0, "x", true);
          const bx = u.valToPos(band.x1, "x", true);
          const x = Math.min(ax, bx);
          const w = Math.abs(bx - ax);
          if (w >= 1) {
            ctx.save();
            ctx.fillStyle = bandColor;
            ctx.fillRect(x, top, w, height);
            ctx.restore();
          }
          return;
        }
        if (!result) return;
        const col = firstVisibleCol(u);
        const scale = u.series[col]?.scale ?? "y";
        const cx = u.valToPos(result.center, "x", true);
        const apexY = u.valToPos(result.height, scale, true);
        const halfY = u.valToPos(result.half, scale, true);
        const px1 = u.valToPos(result.x1, "x", true);
        const px2 = u.valToPos(result.x2, "x", true);
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.5;
        // Dashed center line: apex → bottom axis.
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, apexY);
        ctx.lineTo(cx, baseY);
        ctx.stroke();
        ctx.setLineDash([]);
        // Solid half-max crossbar x1 → x2 with end caps.
        ctx.beginPath();
        ctx.moveTo(px1, halfY);
        ctx.lineTo(px2, halfY);
        ctx.moveTo(px1, halfY - 4);
        ctx.lineTo(px1, halfY + 4);
        ctx.moveTo(px2, halfY - 4);
        ctx.lineTo(px2, halfY + 4);
        ctx.stroke();
        // Apex dot.
        ctx.beginPath();
        ctx.arc(cx, apexY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
    },
  };
}
