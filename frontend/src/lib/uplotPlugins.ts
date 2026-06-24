// uPlot plugins for the plot tool-dock: drag-to-pan and a cursor readout.

import type uPlot from "uplot";

import type { RefLine } from "./types";

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

/** Readout reported by the cursor plugin (null when off-data). */
export interface Readout {
  x: number;
  y: number;
  label: string;
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

/** Report the nearest data point under the cursor (or null when off-plot). */
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
        const y = u.data[1]?.[idx];
        if (x == null || y == null) {
          onReadout(null);
          return;
        }
        const lbl = u.series[1]?.label;
        onReadout({ x, y, label: typeof lbl === "string" ? lbl : "" });
      },
    },
  };
}
