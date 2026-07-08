// Canvas2D rendering for the statistical-plot stage (gap #16): box/whisker,
// violin, Q-Q, and histogram+fit — one dispatcher over a small discriminated
// union so StatStage stays a thin shell (the MapStage / mapRender.ts split).
// All scale/layout math is pulled from lib/statstage (pure, unit-tested);
// this file only turns already-computed numbers into canvas calls, so it's
// testable via a real jsdom/node-canvas raster (mapRender.test.ts's pattern)
// without any React/store dependency.

import { niceTicks } from "../../lib/ticks";
import {
  categorySlots,
  finiteDomain,
  violinOutline,
  zeroBasedDomain,
  type BoxStat,
} from "../../lib/statstage";
import { seriesColor } from "../../lib/uplotOpts";

const MARGIN = { left: 60, right: 20, top: 20, bottom: 48 };

export interface ViolinGroup {
  label: string;
  x: number[];
  density: number[];
  /** [q1, median, q3] — drawn as a thin inner reference box (seaborn style). */
  quartiles: [number, number, number];
  n: number;
}

export type StatDrawData =
  | { mode: "box"; boxes: BoxStat[]; valueLabel: string; groupLabel: string }
  | { mode: "violin"; violins: ViolinGroup[]; valueLabel: string; groupLabel: string }
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
    };

type Rect = { x: number; y: number; w: number; h: number };

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

function truncateLabel(s: string, max = 14): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** "n=<count>" caption above a box/violin (shared by both modes). */
function drawCountLabel(ctx: CanvasRenderingContext2D, cx: number, top: number, n: number, muted: string) {
  ctx.fillStyle = muted;
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(`n=${n}`, cx, top - 4);
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

  if (data.mode === "box") drawBoxes(ctx, rect, data, ink, muted);
  else if (data.mode === "violin") drawViolins(ctx, rect, data, ink, muted);
  else if (data.mode === "qq") drawQQ(ctx, rect, data, ink, muted);
  else drawHistogram(ctx, rect, data, ink, muted);
}

// ── Shared axes ──────────────────────────────────────────────────────────────

function drawValueAxis(
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

function drawCategoryAxis(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  slots: { cx: number }[],
  labels: string[],
  caption: string,
  ink: string,
  muted: string,
) {
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.fillStyle = muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  slots.forEach((s, i) => {
    const sx = rect.x + s.cx * rect.w;
    ctx.fillText(truncateLabel(labels[i] ?? ""), sx, rect.y + rect.h + 6);
  });
  ctx.fillStyle = ink;
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.fillText(caption, rect.x + rect.w / 2, rect.y + rect.h + 30);
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

// ── Box ──────────────────────────────────────────────────────────────────────

function drawBoxes(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  d: Extract<StatDrawData, { mode: "box" }>,
  ink: string,
  muted: string,
) {
  if (!d.boxes.length) return;
  const domain = finiteDomain(d.boxes.map((b) => [b.whislo, b.whishi, ...b.fliers]));
  drawValueAxis(ctx, rect, domain, d.valueLabel, ink, muted);
  const slots = categorySlots(d.boxes.length);
  drawCategoryAxis(ctx, rect, slots, d.boxes.map((b) => b.label), d.groupLabel, ink, muted);

  const vy = (v: number) => rect.y + rect.h - ((v - domain[0]) / (domain[1] - domain[0])) * rect.h;

  d.boxes.forEach((b, i) => {
    const slot = slots[i];
    const cx = rect.x + slot.cx * rect.w;
    const hw = slot.halfWidth * rect.w;
    const color = seriesColor(i);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(cx, vy(b.whislo));
    ctx.lineTo(cx, vy(b.q1));
    ctx.moveTo(cx, vy(b.q3));
    ctx.lineTo(cx, vy(b.whishi));
    ctx.stroke();
    const capW = hw * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - capW, vy(b.whislo));
    ctx.lineTo(cx + capW, vy(b.whislo));
    ctx.moveTo(cx - capW, vy(b.whishi));
    ctx.lineTo(cx + capW, vy(b.whishi));
    ctx.stroke();

    const yTop = vy(b.q3);
    const yBot = vy(b.q1);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = color;
    ctx.fillRect(cx - hw, yTop, hw * 2, Math.max(1, yBot - yTop));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.strokeRect(cx - hw, yTop, hw * 2, Math.max(1, yBot - yTop));

    ctx.beginPath();
    ctx.moveTo(cx - hw, vy(b.median));
    ctx.lineTo(cx + hw, vy(b.median));
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = color;
    for (const f of b.fliers) {
      ctx.beginPath();
      ctx.arc(cx, vy(f), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }

    drawCountLabel(ctx, cx, rect.y, b.n, muted);
  });
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
  const slots = categorySlots(d.violins.length);
  drawCategoryAxis(ctx, rect, slots, d.violins.map((v) => v.label), d.groupLabel, ink, muted);

  const vy = (v: number) => rect.y + rect.h - ((v - domain[0]) / (domain[1] - domain[0])) * rect.h;

  d.violins.forEach((v, i) => {
    const slot = slots[i];
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

    drawCountLabel(ctx, cx, rect.y, v.n, muted);
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
