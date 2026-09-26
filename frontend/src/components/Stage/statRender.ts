// Canvas2D rendering for the statistical-plot stage (gap #16): box/whisker,
// violin, Q-Q, and histogram+fit — one dispatcher over a small discriminated
// union so StatStage stays a thin shell (the MapStage / mapRender.ts split).
// All scale/layout math is pulled from lib/statstage (pure, unit-tested);
// this file only turns already-computed numbers into canvas calls, so it's
// testable via a real jsdom/node-canvas raster (mapRender.test.ts's pattern)
// without any React/store dependency.
//
// The box-family marks (raw-point jitter overlay, mean+-CI marker, and the
// points-only "strip" mode -- JMP_GAP J5) live in `statRenderBox.ts`, split
// out to keep this dispatcher from re-growing past the god-module ceiling
// (same MapStage/mapRender.ts precedent this file's own split follows); the
// shared axis helpers below are exported so that module can reuse them
// rather than duplicating axis-drawing code.

import type { BarChartData } from "../../lib/barlayout";
import type { AxisSlot } from "../../lib/groupAxis";
import { niceTicks } from "../../lib/ticks";
import { drawCategoryAxis } from "./statRenderAxes";
import {
  finiteDomain,
  violinOutline,
  zeroBasedDomain,
  type BoxStat,
  type IndexedGroupSpec,
} from "../../lib/statstage";
import { seriesColor } from "../../lib/uplotOpts";
import { drawBar } from "./statRenderBar";
import { drawBoxesWithMarks, drawStrip } from "./statRenderBox";
import { drawEmptySlotMarkers, drawSlotCounts, slotPlan } from "./statRenderSlots";

const MARGIN = { left: 60, right: 20, top: 20, bottom: 48 };

export interface ViolinGroup {
  label: string;
  x: number[];
  density: number[];
  /** [q1, median, q3] — drawn as a thin inner reference box (seaborn style). */
  quartiles: [number, number, number];
  n: number;
}

/** One group's raw finite points (rowIndex-tagged) for the "show points"
 *  jittered overlay (JMP_GAP J5 #1) — structurally the same shape
 *  `resolveGroupsIndexed` returns (`lib/statschooser.IndexedGroupSpec`). */
export type BoxPointsGroup = IndexedGroupSpec;

/** P2.6 box 2, on every categorical draw: `slots` places the plotted groups on
 *  an axis that may carry EMPTY slots (`lib/groupAxis`; absent = one slot per
 *  group, as before), and `showN` gates the `n=` captions (absent = shown, the
 *  stage's long-standing behaviour). */
export interface CategoryAxisMarks {
  slots?: AxisSlot[] | null;
  showN?: boolean;
}

export type StatDrawData =
  | {
      mode: "box";
      boxes: BoxStat[];
      valueLabel: string;
      groupLabel: string;
      /** Raw finite values (rowIndex-tagged) per group for the "show points"
       *  jittered overlay (JMP_GAP J5 #1) — absent/null when the toggle is
       *  off, so `drawBoxesWithMarks` simply skips the overlay. Index-aligned
       *  with `boxes` (same group order). */
      points?: BoxPointsGroup[] | null;
      /** Draw a mean +/- 95% CI diamond+whisker marker per group (JMP_GAP J5
       *  #2), reading `boxes[i].mean/ciLo/ciHi`. */
      showMeanCI?: boolean;
      /** Draw a dashed line connecting each group's mean, in on-screen
       *  category order (JMP_GAP J5 residual, the "interaction plot" read)
       *  — reads `boxes[i].mean` via `lib/statstage.connectMeansSeries`. */
      connectMeans?: boolean;
    } & CategoryAxisMarks
  | ({ mode: "violin"; violins: ViolinGroup[]; valueLabel: string; groupLabel: string } & CategoryAxisMarks)
  | {
      mode: "qq";
      theo: number[];
      obs: number[];
      slope: number;
      intercept: number;
      dist: string;
      valueLabel: string;
    }
  | {
      mode: "histogram";
      edges: number[];
      counts: number[];
      density: boolean;
      fit?: { x: number[]; pdf: number[]; dist: string };
      valueLabel: string;
    }
  | {
      mode: "bar";
      data: BarChartData;
      valueLabel: string;
      groupLabel: string;
      /** false = clustered (grouped) bars side by side; true = one stacked
       *  bar per category, series drawn bottom-to-top. */
      stacked: boolean;
      /** Gates the per-bar `n=` captions (absent = shown). An empty category
       *  is a group whose every series has n=0 (`lib/groupAxis.padBarData`). */
      showN?: boolean;
    }
  | {
      /** Points-only categorical plot (JMP_GAP J5 #3): same category slots
       *  as box, but no quartile/whisker glyph — just jittered points, plus
       *  an optional mean+-CI marker. Reuses `BoxStat` for its mean/sem/
       *  ci95/n/label (never the quartile/whisker fields). */
      mode: "strip";
      boxes: BoxStat[];
      points: BoxPointsGroup[];
      valueLabel: string;
      groupLabel: string;
      showMeanCI: boolean;
      /** See the `box` variant's `connectMeans` doc above. */
      connectMeans: boolean;
    } & CategoryAxisMarks;

export type Rect = { x: number; y: number; w: number; h: number };

function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== "function") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Compact numeric label: ≤4 sig figs, exponential outside [1e-3, 1e5). */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
}

function plotRect(w: number, h: number): Rect {
  return {
    x: MARGIN.left,
    y: MARGIN.top,
    w: Math.max(1, w - MARGIN.left - MARGIN.right),
    h: Math.max(1, h - MARGIN.top - MARGIN.bottom),
  };
}

export function draw(canvas: HTMLCanvasElement, host: HTMLElement, data: StatDrawData | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // jsdom / headless — nothing to paint
  const W = host.clientWidth || 600;
  const H = host.clientHeight || 400;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!data) return;

  const ink = cssVar("--text", "#e6e6e6");
  const muted = cssVar("--text-dim", "#9aa");
  const rect = plotRect(W, H);
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);

  if (data.mode === "box") drawBoxesWithMarks(ctx, rect, data, ink, muted);
  else if (data.mode === "strip") drawStrip(ctx, rect, data, ink, muted);
  else if (data.mode === "violin") drawViolins(ctx, rect, data, ink, muted);
  else if (data.mode === "qq") drawQQ(ctx, rect, data, ink, muted);
  else if (data.mode === "bar") drawBar(ctx, rect, data, ink, muted);
  else drawHistogram(ctx, rect, data, ink, muted);
}

// ── Shared axes (also used by statRenderBox.ts / statRenderBar.ts) ──────────

export function drawValueAxis(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  domain: [number, number],
  caption: string,
  ink: string,
  muted: string,
) {
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.strokeStyle = muted;
  ctx.fillStyle = muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const v of niceTicks(domain[0], domain[1])) {
    const sy = rect.y + rect.h - ((v - domain[0]) / (domain[1] - domain[0])) * rect.h;
    ctx.beginPath();
    ctx.moveTo(rect.x - 4, sy);
    ctx.lineTo(rect.x, sy);
    ctx.stroke();
    ctx.fillText(fmt(v), rect.x - 7, sy);
  }
  ctx.save();
  ctx.fillStyle = ink;
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.translate(14, rect.y + rect.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(caption, 0, 0);
  ctx.restore();
}

function drawNumericXAxis(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  domain: [number, number],
  caption: string,
  ink: string,
  muted: string,
) {
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.fillStyle = muted;
  ctx.strokeStyle = muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const v of niceTicks(domain[0], domain[1])) {
    const sx = rect.x + ((v - domain[0]) / (domain[1] - domain[0])) * rect.w;
    ctx.beginPath();
    ctx.moveTo(sx, rect.y + rect.h);
    ctx.lineTo(sx, rect.y + rect.h + 4);
    ctx.stroke();
    ctx.fillText(fmt(v), sx, rect.y + rect.h + 6);
  }
  ctx.fillStyle = ink;
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.fillText(caption, rect.x + rect.w / 2, rect.y + rect.h + 24);
}

// ── Violin ───────────────────────────────────────────────────────────────────

function drawViolins(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  d: Extract<StatDrawData, { mode: "violin" }>,
  ink: string,
  muted: string,
) {
  if (!d.violins.length) return;
  const domain = finiteDomain(d.violins.map((v) => [v.x[0] ?? 0, v.x[v.x.length - 1] ?? 0]));
  drawValueAxis(ctx, rect, domain, d.valueLabel, ink, muted);
  const plan = slotPlan(d.slots, d.violins.map((v) => v.label));
  drawCategoryAxis(ctx, rect, plan.slots, plan.labels, d.groupLabel, ink, muted);
  drawEmptySlotMarkers(ctx, rect, plan, muted);
  if (d.showN !== false) drawSlotCounts(ctx, rect, plan, d.violins.map((v) => v.n), muted);

  const vy = (v: number) => rect.y + rect.h - ((v - domain[0]) / (domain[1] - domain[0])) * rect.h;

  d.violins.forEach((v, i) => {
    const slot = plan.slots[plan.groupSlot[i]];
    const cx = rect.x + slot.cx * rect.w;
    const hw = slot.halfWidth * rect.w;
    const color = seriesColor(i);
    const outline = violinOutline(v.x, v.density);
    if (outline.length < 2) return;

    ctx.beginPath();
    outline.forEach((p, k) => {
      const px = cx + p.halfWidth * hw;
      const py = vy(p.value);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    for (let k = outline.length - 1; k >= 0; k--) {
      const p = outline[k];
      ctx.lineTo(cx - p.halfWidth * hw, vy(p.value));
    }
    ctx.closePath();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // Thin inner quartile reference (seaborn-style): a bar from q1 to q3 + a
    // median dot, always drawn in ink so it reads against any series color.
    const [q1, med, q3] = v.quartiles;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, vy(q1));
    ctx.lineTo(cx, vy(q3));
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(cx, vy(med), 2, 0, 2 * Math.PI);
    ctx.fill();
  });
}

// ── Q-Q ──────────────────────────────────────────────────────────────────────

function drawQQ(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  d: Extract<StatDrawData, { mode: "qq" }>,
  ink: string,
  muted: string,
) {
  if (!d.theo.length) return;
  const xDomain = finiteDomain([d.theo]);
  const lineVals: [number, number] = [
    d.slope * xDomain[0] + d.intercept,
    d.slope * xDomain[1] + d.intercept,
  ];
  const yDomain = finiteDomain([d.obs, lineVals]);
  drawNumericXAxis(ctx, rect, xDomain, `Theoretical quantiles (${d.dist})`, ink, muted);
  drawValueAxis(ctx, rect, yDomain, `Sample quantiles (${d.valueLabel})`, ink, muted);

  const sx = (v: number) => rect.x + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * rect.w;
  const sy = (v: number) => rect.y + rect.h - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * rect.h;

  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(sx(xDomain[0]), sy(lineVals[0]));
  ctx.lineTo(sx(xDomain[1]), sy(lineVals[1]));
  ctx.stroke();
  ctx.setLineDash([]);

  const color = seriesColor(0);
  ctx.fillStyle = color;
  for (let i = 0; i < d.theo.length; i++) {
    ctx.beginPath();
    ctx.arc(sx(d.theo[i]), sy(d.obs[i]), 2.5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

// ── Histogram ────────────────────────────────────────────────────────────────

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  d: Extract<StatDrawData, { mode: "histogram" }>,
  ink: string,
  muted: string,
) {
  if (!d.counts.length) return;
  const xDomain = finiteDomain([d.edges]);
  const yDomain = zeroBasedDomain([d.counts, d.fit?.pdf ?? []]);
  drawNumericXAxis(ctx, rect, xDomain, d.valueLabel, ink, muted);
  drawValueAxis(ctx, rect, yDomain, d.density ? "density" : "count", ink, muted);

  const sx = (v: number) => rect.x + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * rect.w;
  const sy = (v: number) => rect.y + rect.h - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * rect.h;

  const color = seriesColor(0);
  for (let i = 0; i < d.counts.length; i++) {
    const x0 = sx(d.edges[i]);
    const x1 = sx(d.edges[i + 1]);
    const yTop = sy(d.counts[i]);
    const barX = Math.min(x0, x1);
    const barW = Math.abs(x1 - x0);
    const barH = rect.y + rect.h - yTop;
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = color;
    ctx.fillRect(barX, yTop, barW, barH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, yTop, barW, barH);
  }

  if (d.fit && d.fit.x.length) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    d.fit.x.forEach((v, i) => {
      const px = sx(v);
      const py = sy(d.fit!.pdf[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
}

// Re-exported so `statRenderBox.ts` and the tests keep one import site.
export { drawCategoryAxis } from "./statRenderAxes";
export { drawCountLabel } from "./statRenderSlots";
