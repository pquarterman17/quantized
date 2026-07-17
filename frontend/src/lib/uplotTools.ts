// Interactive uPlot tool-dock gestures: drag-to-pan, the data-cursor readout,
// the two-point measure ruler, region statistics, and wheel-to-zoom. Each binds
// its pointer listeners in a `ready` hook and holds live state in DATA coords
// (canvas redraw only — no React rerender), tearing down per-drag listeners on
// release. Passive overlays live in uplotOverlays; the region-analysis tools
// (integrate / FWHM) live in uplotRegionTools.

import type uPlot from "uplot";

import { setActiveGestureCancel } from "./gestureCancel";
import { computeMeasurement, type Measurement } from "./measure";
import { computeRegionStats, type RegionStats } from "./regionStats";

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
            setActiveGestureCancel(null);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
          // GUI_INTERACTION #9: Escape/right-click cancel — restore the pan's
          // starting scales (a pan has no "committed result" to discard, just
          // the view it moved) and tear down like a normal release.
          setActiveGestureCancel(() => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            over.style.cursor = "grab";
            u.setScale("x", { min: x0min, max: x0max });
            u.setScale("y", { min: y0min, max: y0max });
          });
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
            setActiveGestureCancel(null);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
          // GUI_INTERACTION #9: Escape/right-click cancel — discard the live
          // segment (no onMeasure commit) and tear down like a normal release.
          setActiveGestureCancel(() => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            seg = null;
            onMeasure(null);
            u.redraw();
          });
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
            setActiveGestureCancel(null);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
          // GUI_INTERACTION #9: Escape/right-click cancel — discard the live
          // band (no onStats commit) and tear down like a normal release.
          setActiveGestureCancel(() => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            band = null;
            recompute(u);
            u.redraw();
          });
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
