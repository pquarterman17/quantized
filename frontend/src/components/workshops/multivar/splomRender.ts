// Multivariate workbench (JMP_GAP J10) — SPLOM canvas renderer: one shared
// Canvas2D component draws the whole n×n small-multiples grid (statRender.ts's
// "pure `draw(canvas, host, data)`" pattern, so it's testable against a real
// canvas raster the same way, `statRender.test.ts`'s precedent). Diagonal
// (item 3) is a small histogram sparkline (lib/multivar.miniHistogram, no
// extra fetch); off-diagonal cell (row i, col j) is a scatter of column j
// (x) against column i (y) — the classic SPLOM layout, sharing each
// column's domain down its whole row/column like JMP does.
//
// Point downsampling above SPLOM_MAX_POINTS (lib/multivar) is the CALLER's
// job (SplomView.tsx) — this module only ever draws exactly the rows it's
// given, so it stays a pure "numbers in, pixels out" renderer with no
// opinion about how many points is "too many".

import { miniHistogram } from "../../../lib/multivar";
import { finiteDomain } from "../../../lib/statstage";
import { seriesColor } from "../../../lib/uplotOpts";

export interface SplomDrawData {
  labels: string[];
  /** Row-major matrix: `rows[r][c]` is column `c`'s value at row `r`.
   *  Already the exact (possibly downsampled) point set to draw. */
  rows: number[][];
}

type Rect = { x: number; y: number; w: number; h: number };

function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== "function") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const OUTER_LABEL_BAND = 30;
const CELL_GAP = 2;

export function draw(canvas: HTMLCanvasElement, host: HTMLElement, data: SplomDrawData | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // jsdom / headless — nothing to paint
  const W = host.clientWidth || 600;
  const H = host.clientHeight || 600;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!data || data.labels.length < 2) return;

  const n = data.labels.length;
  const muted = cssVar("--text-dim", "#9aa");
  const border = cssVar("--border", "#333");
  const dot = seriesColor(0);

  const gridX = OUTER_LABEL_BAND;
  const gridY = 4;
  const gridSize = Math.max(1, Math.min(W - gridX - 4, H - OUTER_LABEL_BAND - gridY));
  const cell = gridSize / n;

  // Column-major view + a shared per-column domain (padded), reused down
  // that column's whole row and up its whole column — JMP-style shared axes.
  const columns: number[][] = Array.from({ length: n }, (_, c) => data.rows.map((r) => r[c]));
  const domains = columns.map((col) => finiteDomain([col], 0.06));

  ctx.font = "9px 'JetBrains Mono', monospace";

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const rect: Rect = { x: gridX + j * cell, y: gridY + i * cell, w: cell - CELL_GAP, h: cell - CELL_GAP };
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);

      if (i === j) drawDiagonal(ctx, rect, columns[i], dot);
      else drawScatter(ctx, rect, columns[j], columns[i], domains[j], domains[i], dot);
    }
    ctx.fillStyle = muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(truncate(data.labels[i], 10), gridX - 4, gridY + i * cell + cell / 2);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let j = 0; j < n; j++) {
    ctx.fillStyle = muted;
    ctx.fillText(truncate(data.labels[j], 10), gridX + j * cell + cell / 2, gridY + gridSize + 4);
  }
}

function drawScatter(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  xs: number[],
  ys: number[],
  xDomain: [number, number],
  yDomain: [number, number],
  color: string,
): void {
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const xSpan = x1 - x0 || 1;
  const ySpan = y1 - y0 || 1;
  const sx = (v: number) => rect.x + ((v - x0) / xSpan) * rect.w;
  const sy = (v: number) => rect.y + rect.h - ((v - y0) / ySpan) * rect.h;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  for (let k = 0; k < xs.length; k++) {
    const x = xs[k];
    const y = ys[k];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    ctx.beginPath();
    ctx.arc(sx(x), sy(y), 1.6, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawDiagonal(ctx: CanvasRenderingContext2D, rect: Rect, values: number[], color: string): void {
  const bins = Math.max(6, Math.min(16, Math.round(rect.w / 6)));
  const hist = miniHistogram(values, bins);
  if (!hist.counts.length) return;
  const barW = rect.w / hist.counts.length;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.5;
  hist.counts.forEach((c, i) => {
    const barH = hist.max > 0 ? (c / hist.max) * (rect.h - 4) : 0;
    ctx.fillRect(rect.x + i * barW + 0.5, rect.y + rect.h - barH, Math.max(1, barW - 1), barH);
  });
  ctx.globalAlpha = 1;
}
