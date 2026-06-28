// uPlot plugins for the plot tool-dock: drag-to-pan and a cursor readout.

import type uPlot from "uplot";

import { computeMeasurement, type Measurement } from "./measure";
import type { Annotation, RefLine } from "./types";

/** Draw dashed reference lines at fixed X/Y values, clipped to the plot area. */
export function refLinePlugin(lines: RefLine[], color: string): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        for (const ln of lines) {
          if (!Number.isFinite(ln.value)) continue;
          ctx.beginPath();
          if (ln.axis === "x") {
            const px = u.valToPos(ln.value, "x", true);
            if (px < left || px > left + width) continue;
            ctx.moveTo(px, top);
            ctx.lineTo(px, top + height);
          } else {
            const py = u.valToPos(ln.value, "y", true);
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
