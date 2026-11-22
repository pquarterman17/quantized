// The canvas side of the scatter overlays (`lib/plotOverlays.ts`), loaded on
// demand the first time a graph turns an overlay on. It (1) picks the series an
// overlay applies to, (2) asks `POST /api/plot/overlays` for the curves (the
// SAME computation the vector export draws, `calc/figure_overlays.py`), and
// (3) draws them over a uPlot instance with a small key naming each one.
//
// Fail closed: an overlay the backend refuses (too few points, constant X,
// collinear points, infinite values, ...) is not drawn, and the key says so with
// the reason. Rows excluded from the analysis arrive as nulls in the payload, so
// they never enter a fit; the grey "(excluded)" companions are skipped.

import type uPlot from "uplot";

import { postJSON } from "./api/http";
import type { PlotPayload } from "./plotdata";
import { overlaysWire, type PlotOverlays } from "./plotOverlays";
import type { SeriesStyle } from "./seriesStyleTypes";

type Num = number | null;
interface Curve { x: Num[]; y: Num[] }
export interface SeriesOverlays {
  label: string;
  line?: Curve & { label: string; band: (null | { lo: Num[]; hi: Num[]; label: string }) };
  smoother?: Curve & { label: string };
  ellipse?: Curve & { label: string };
  refused: Record<string, string>;
}
export interface OverlayResult { col: number; res: SeriesOverlays }

export interface OverlayInputs { x: Num[]; cols: number[]; series: { label: string; y: Num[] }[] }

/** The series an overlay applies to, or why none can be used. */
export function overlayInputs(
  payload: PlotPayload,
  hidden: readonly boolean[] | undefined,
  styles: readonly (SeriesStyle | undefined)[] | undefined,
): OverlayInputs | { refusal: string } {
  if (payload.decimated || payload.window || payload.rowIds) {
    return { refusal: "not drawn: the plot is thinned for display (use the Scatter default trace to plot every point)" };
  }
  if (payload.yShift) return { refusal: "not drawn on a waterfall (its offsets are display-only)" };
  if (payload.xCategories || payload.blockRows) return { refusal: "not drawn on a categorical or block-offset X axis" };
  const cols: number[] = [];
  const series: { label: string; y: Num[] }[] = [];
  payload.series.forEach((s, i) => {
    const st = styles?.[i];
    if (s.overlay || s.band !== undefined || s.muted || s.selected || s.axis === 1 || hidden?.[i] || s.kind === "points") return;
    if (st?.bars || st?.stack) return;
    cols.push(i + 1);
    series.push({ label: s.label, y: payload.data[i + 1] as Num[] });
  });
  if (series.length === 0) return { refusal: "not drawn: no plotted curve to overlay" };
  return { x: payload.data[0] as Num[], cols, series };
}

/** Ask the backend for every series' overlays. */
export async function fetchOverlays(inputs: OverlayInputs, overlays: PlotOverlays, signal?: AbortSignal): Promise<OverlayResult[]> {
  const body = { x: inputs.x, series: inputs.series, overlays: overlaysWire(overlays) };
  const res = await postJSON<{ series: SeriesOverlays[] }>("/api/plot/overlays", body, signal);
  return res.series.map((r, i) => ({ col: inputs.cols[i]!, res: r }));
}

function ink(u: uPlot, col: number): string {
  const stroke = u.series[col]?.stroke;
  const v = typeof stroke === "function" ? stroke(u, col) : stroke;
  return typeof v === "string" ? v : getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#888";
}

function path(u: uPlot, c: Curve): Path2D | null {
  const p = new Path2D();
  let any = false;
  c.x.forEach((xv, i) => {
    const yv = c.y[i];
    if (xv == null || yv == null) return;
    const px = u.valToPos(xv, "x", true), py = u.valToPos(yv, "y", true);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    if (any) p.lineTo(px, py); else p.moveTo(px, py);
    any = true;
  });
  return any ? p : null;
}

interface KeyRow { color: string; dash: number[]; text: string; muted: boolean }

/** Draw every overlay and the key; `refusal` (a whole-plot reason) is just the key. */
export function drawOverlays(u: uPlot, results: readonly OverlayResult[], refusal: string | null): void {
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const px = uPlotRatio();
  const several = results.length > 1;
  const rows: KeyRow[] = refusal ? [{ color: "", dash: [], text: `Overlays ${refusal}`, muted: true }] : [];
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  for (const { col, res } of results) {
    const color = ink(u, col);
    const name = (t: string) => (several && res.label ? `${res.label}: ${t}` : t);
    const b = res.line?.band;
    if (res.line && b) {
      const lo = path(u, { x: res.line.x, y: b.lo }), hi = path(u, { x: [...res.line.x].reverse(), y: [...b.hi].reverse() });
      if (lo && hi) {
        const area = new Path2D(lo);
        area.addPath(hi);
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = color;
        ctx.fill(area);
        ctx.globalAlpha = 1;
      }
      rows.push({ color, dash: [], text: name(b.label), muted: false });
    }
    if (res.line) stroke(ctx, path(u, res.line), color, 1.5 * px, []);
    if (res.line) rows.push({ color, dash: [], text: name(res.line.label), muted: false });
    if (res.smoother) {
      stroke(ctx, path(u, res.smoother), color, 1.5 * px, [6 * px, 4 * px]);
      rows.push({ color, dash: [4, 3], text: name(res.smoother.label), muted: false });
    }
    if (res.ellipse) {
      const p = path(u, res.ellipse);
      if (p) {
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = color;
        ctx.fill(p);
        ctx.globalAlpha = 1;
      }
      stroke(ctx, p, color, 1 * px, [2 * px, 3 * px]);
      rows.push({ color, dash: [2, 3], text: name(res.ellipse.label), muted: false });
    }
    for (const [kind, why] of Object.entries(res.refused)) rows.push({ color, dash: [], text: name(`${kind} not drawn: ${why}`), muted: true });
  }
  ctx.restore();
  drawKey(u, rows, px);
}

function stroke(ctx: CanvasRenderingContext2D, p: Path2D | null, color: string, w: number, dash: number[]): void {
  if (!p) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.setLineDash(dash);
  ctx.stroke(p);
  ctx.restore();
}

const uPlotRatio = (): number => (typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1);

/** The overlay key: bottom-right inside the plot, one row per drawn or refused overlay. */
function drawKey(u: uPlot, rows: KeyRow[], px: number): void {
  if (rows.length === 0) return;
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const css = getComputedStyle(document.documentElement);
  const font = `${11 * px}px ${css.getPropertyValue("--font-mono").trim() || "monospace"}`;
  const text = css.getPropertyValue("--text").trim() || "#222";
  const dim = css.getPropertyValue("--text-dim").trim() || "#666";
  const bg = css.getPropertyValue("--axes-bg-light").trim() || "#fff";
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = "middle";
  const lineH = 16 * px, pad = 6 * px, swatch = 22 * px;
  const textW = Math.max(...rows.map((r) => ctx.measureText(r.text).width));
  const boxW = Math.min(width - 2 * pad, pad * 3 + swatch + textW);
  const boxH = rows.length * lineH + pad;
  const x0 = left + width - boxW - pad, y0 = top + height - boxH - pad;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = bg;
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.globalAlpha = 1;
  rows.forEach((r, i) => {
    const y = y0 + pad / 2 + lineH * (i + 0.5);
    if (r.color) {
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash(r.dash.map((d) => d * px));
      ctx.beginPath();
      ctx.moveTo(x0 + pad, y);
      ctx.lineTo(x0 + pad + swatch, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = r.muted ? dim : text;
    ctx.fillText(r.text, x0 + pad * 2 + swatch, y, boxW - pad * 3 - swatch);
  });
  ctx.restore();
}
