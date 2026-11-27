// Canvas drawing of the point labels (lib/pointLabelLayout.ts) over a uPlot
// instance: each label sits up and to the right of its point in the curve's own
// colour, clipped to the plot area, and the layout's one-line message (a
// refusal or a thinning note) is printed bottom-left. The export draws the same
// list and message (`calc/figure_point_labels.py`).

import type uPlot from "uplot";

import { layoutMessage } from "./pointLabelLayout";
import { DEFAULT_TICK_PX, labelMetrics, tickPxOf } from "./pointLabelMetrics";
import { drawAvoiding, overlapNote, type AvoidAnchor } from "./pointLabelsAvoidDraw";
import type { LabelLayout } from "./pointLabelText";

const ratio = (): number => (typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1);

function ink(u: uPlot, col: number): string {
  const stroke = u.series[col]?.stroke;
  const v = typeof stroke === "function" ? stroke(u, col) : stroke;
  return typeof v === "string" ? v : getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#222";
}

/** Draw `layout`; `plotted` maps a dataset channel to its uPlot series (index + 1). */
export function drawPointLabels(u: uPlot, layout: LabelLayout, plotted: readonly number[]): void {
  const message = layoutMessage(layout);
  if (layout.points.length === 0 && !message) return;
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const px = ratio();
  const css = getComputedStyle(document.documentElement);
  ctx.save();
  const family = css.getPropertyValue("--font-mono").trim() || "monospace";
  // The labels keep the export's size relative to the ticks (lib/pointLabelMetrics.ts); the one-line note keeps its own 11 px.
  const m = labelMetrics(tickPxOf(u.axes?.[0]?.font, DEFAULT_TICK_PX * px));
  ctx.font = `${m.fontPx}px ${family}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left"; // uPlot leaves "right"/"center" from its axes; the labels and note are placed by their left edge
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  const anchors: AvoidAnchor[] = [];
  for (const p of layout.points) {
    const col = plotted.indexOf(p.ch) + 1;
    if (col === 0 || u.series[col]?.show === false) continue;
    const x = u.valToPos(p.x, "x", true), y = u.valToPos(p.y, "y", true);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (layout.avoid) {
      const size = u.series[col]?.points?.size;
      anchors.push({ text: p.text, x, y, importance: Math.abs(p.y), color: ink(u, col), markerR: ((typeof size === "number" ? size : 5) / 2) * px });
      continue;
    }
    ctx.fillStyle = ink(u, col);
    ctx.fillText(p.text, x + m.gap, y - m.gap);
  }
  const noteH = 11 * px * 1.2;
  const shown = layout.avoid ? overlapNote(drawAvoiding(u, anchors, layout.avoid, px, m, message ? noteH + 6 * px : 0)) : null;
  const text = shown ? (message ? `${message}; ${shown}` : shown) : message;
  if (text) {
    ctx.font = `${11 * px}px ${family}`;
    ctx.fillStyle = css.getPropertyValue("--text-dim").trim() || "#666";
    ctx.fillText(text, left + 6 * px, top + height - 6 * px, width - 12 * px);
  }
  ctx.restore();
}
