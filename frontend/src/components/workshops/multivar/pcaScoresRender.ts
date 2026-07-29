// Multivariate workbench (JMP_GAP J10) — PCA scores/loadings/biplot canvas
// renderer. Same pure `draw(canvas, host, data)` shape as statRender.ts /
// splomRender.ts (real-raster testable, no React/store). One renderer serves
// three view modes via which of `points`/`vectors` the caller populates:
//   - Scores:   points only.
//   - Loadings: vectors only (unit-circle-ish, domain from the vectors).
//   - Biplot:   both — vectors are rescaled into the SCORE cloud's domain
//               (the classic biplot convention, e.g. R's `biplot()`: scale
//               so the longest vector reaches ~85% of the score radius) so
//               they read as directions, not literal score-scale units.

import { finiteDomain } from "../../../lib/statstage";
import { seriesColor } from "../../../lib/uplotOpts";

export interface PcaVector {
  x: number;
  y: number;
  label: string;
}

export interface PcaDrawData {
  points: [number, number][];
  vectors: PcaVector[];
  xLabel: string;
  yLabel: string;
}

type Rect = { x: number; y: number; w: number; h: number };

function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== "function") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const MARGIN = { left: 44, right: 16, top: 12, bottom: 34 };

function plotRect(w: number, h: number): Rect {
  return {
    x: MARGIN.left,
    y: MARGIN.top,
    w: Math.max(1, w - MARGIN.left - MARGIN.right),
    h: Math.max(1, h - MARGIN.top - MARGIN.bottom),
  };
}

export function draw(canvas: HTMLCanvasElement, host: HTMLElement, data: PcaDrawData | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = host.clientWidth || 400;
  const H = host.clientHeight || 320;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!data || (data.points.length === 0 && data.vectors.length === 0)) return;

  const ink = cssVar("--text", "#e6e6e6");
  const muted = cssVar("--text-dim", "#9aa");
  const rect = plotRect(W, H);

  const hasPoints = data.points.length > 0;
  const hasVectors = data.vectors.length > 0;

  const pointDomainX = hasPoints ? finiteDomain([data.points.map((p) => p[0])], 0.12) : null;
  const pointDomainY = hasPoints ? finiteDomain([data.points.map((p) => p[1])], 0.12) : null;

  // Biplot vector scaling: when points are ALSO shown, rescale vectors so the
  // longest one reaches ~85% of the score cloud's radius (R's biplot()
  // convention) — vectors read as directions, not literal score units.
  let vecScale = 1;
  if (hasVectors && hasPoints && pointDomainX && pointDomainY) {
    const scoreRadius = Math.max(Math.abs(pointDomainX[0]), Math.abs(pointDomainX[1]), Math.abs(pointDomainY[0]), Math.abs(pointDomainY[1]));
    const loadingRadius = Math.max(...data.vectors.map((v) => Math.hypot(v.x, v.y)), 1e-12);
    vecScale = (scoreRadius * 0.85) / loadingRadius;
  }
  const scaledVectors = data.vectors.map((v) => ({ ...v, x: v.x * vecScale, y: v.y * vecScale }));

  const xDomain =
    pointDomainX ??
    finiteDomain(
      [scaledVectors.map((v) => v.x), [0]],
      0.25,
    );
  const yDomain =
    pointDomainY ??
    finiteDomain(
      [scaledVectors.map((v) => v.y), [0]],
      0.25,
    );

  const sx = (v: number) => rect.x + ((v - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * rect.w;
  const sy = (v: number) => rect.y + rect.h - ((v - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * rect.h;

  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);

  // Zero reference lines (a biplot/loadings plot centers on the origin).
  if (xDomain[0] < 0 && xDomain[1] > 0) {
    ctx.beginPath();
    ctx.moveTo(sx(0), rect.y);
    ctx.lineTo(sx(0), rect.y + rect.h);
    ctx.stroke();
  }
  if (yDomain[0] < 0 && yDomain[1] > 0) {
    ctx.beginPath();
    ctx.moveTo(rect.x, sy(0));
    ctx.lineTo(rect.x + rect.w, sy(0));
    ctx.stroke();
  }

  if (hasPoints) {
    ctx.fillStyle = seriesColor(0);
    ctx.globalAlpha = 0.65;
    for (const [x, y] of data.points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      ctx.beginPath();
      ctx.arc(sx(x), sy(y), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (hasVectors) {
    const vecColor = seriesColor(3);
    ctx.strokeStyle = vecColor;
    ctx.fillStyle = vecColor;
    ctx.lineWidth = 1.5;
    ctx.font = "9px 'JetBrains Mono', monospace";
    for (const v of scaledVectors) {
      const x0 = sx(0);
      const y0 = sy(0);
      const x1 = sx(v.x);
      const y1 = sy(v.y);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const angle = Math.atan2(y1 - y0, x1 - x0);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - 6 * Math.cos(angle - 0.4), y1 - 6 * Math.sin(angle - 0.4));
      ctx.lineTo(x1 - 6 * Math.cos(angle + 0.4), y1 - 6 * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fill();
      ctx.textAlign = x1 >= x0 ? "left" : "right";
      ctx.textBaseline = "middle";
      ctx.fillText(v.label, x1 + (x1 >= x0 ? 4 : -4), y1);
    }
  }

  ctx.fillStyle = ink;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(data.xLabel, rect.x + rect.w / 2, rect.y + rect.h + 16);
  ctx.save();
  ctx.translate(12, rect.y + rect.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(data.yLabel, 0, 0);
  ctx.restore();
}
