// Region-analysis tool-dock gestures (the ∫ Integrate + ∩ Peak/FWHM tools): drag
// an x-range over the first visible series; on release commit a result the store
// keeps drawn as a chip until cleared / dataset change. Live drag state is held
// plugin-locally in DATA coords (canvas redraw only); committed results re-derive
// pixels each draw, so they stay pinned across zoom/pan. The pure math lives in
// lib/integrate (trapz) + lib/peakwidth (fwhm) — unit-tested, no uPlot runtime.

import type uPlot from "uplot";

import { trapz } from "./integrate";
import { fwhm, type FwhmResult } from "./peakwidth";

/** Index of the first *visible* y data column (skips legend-hidden series), or 0
 *  if the plot has no series. The integrate/FWHM tools operate on this series —
 *  the topmost plotted trace, matching the "first visible" rule in the handoff. */
function firstVisibleCol(u: uPlot): number {
  for (let s = 1; s < u.series.length; s++) {
    if (u.series[s]?.show !== false) return s;
  }
  return u.series.length > 1 ? 1 : 0;
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
