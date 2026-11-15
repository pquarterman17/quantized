// The tool-dock plugins that only run while their tool is picked: drag-to-pan,
// the two-point measure ruler, region statistics and the data-cursor readout.
// Moved verbatim out of lib/uplotTools.ts (bundle diet slice 27,
// plans/BUNDLE_HEADROOM.md), which keeps wheel zoom, the view bounds and the
// view history that every plot uses. A LAZY chunk: `lib/uplotToolPlugins.ts`
// gathers this module with lib/uplotRegionTools.ts, and `buildOpts` reads it
// through `toolPlugins()` (lib/axisExtrasHook.ts). The plot stage loads it
// once mounted, so a first tool pick normally finds it ready; a plot built
// before it lands rebuilds once it does (Stage/useLazyPlotParts.ts).

import type uPlot from "uplot";

import { setActiveGestureCancel } from "./gestureCancel";
import { computeMeasurement, type Measurement } from "./measure";
import { computeRegionStats, type RegionStats } from "./regionStats";
import { setScalesPx, type Readout, type ReadoutRow } from "./uplotTools";

/**
 * Drag-to-pan: every scale follows the pointer by its pixel delta
 * (`setScalesPx`), so a log axis pans by decades and never reaches zero.
 * Document-level move/up listeners are bound per drag and torn down on
 * release, so destroyed plots leave nothing behind.
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
          let lastX = e.clientX;
          let lastY = e.clientY;
          const start = Object.entries(u.scales).map(([k, s]) => [k, s.min ?? 0, s.max ?? 1] as const);
          const onMove = (ev: MouseEvent) => {
            const dx = ev.clientX - lastX;
            const dy = ev.clientY - lastY;
            lastX = ev.clientX;
            lastY = ev.clientY;
            setScalesPx(u, (k, s) => {
              const d = k === "x" ? dx : dy;
              return [u.valToPos(s.min ?? 0, k) - d, u.valToPos(s.max ?? 1, k) - d];
            });
          };
          const onUp = () => {
            over.style.cursor = "grab";
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            setActiveGestureCancel(null);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
          // GUI_INTERACTION #9: Escape/right-click cancel — tear down like a
          // normal release, then restore the pan's starting scales (a pan has
          // no "committed result" to discard, just the view it moved).
          setActiveGestureCancel(() => {
            onUp();
            u.batch(() => start.forEach(([k, min, max]) => u.setScale(k, { min, max })));
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

/** Report every visible series' value at the nearest-x cursor index (or null when
 *  off-plot / no visible series have a value there). The cursor index is shared
 *  across the aligned data, so one lookup per column gives a full readout.
 *  `shift` (a waterfall's per-column stagger) and the X offset (block b of
 *  `blockRows` rows slid by b·`xStep`) are taken back off: the readout states
 *  the data, not where the display moved it. */
export function readoutPlugin(
  onReadout: (r: Readout | null) => void,
  shift?: number[],
  blockRows?: number,
  xStep?: number,
): uPlot.Plugin {
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
          rows.push({ label: typeof lbl === "string" ? lbl : "", y: y - (shift?.[s] ?? 0) });
        }
        if (rows.length === 0) {
          onReadout(null);
          return;
        }
        onReadout({ x: blockRows && xStep ? x - Math.floor(idx / blockRows) * xStep : x, rows });
      },
    },
  };
}
