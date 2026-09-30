// The Graph Builder mini-preview's Canvas2D painters (scatter/line/step, one
// panel or a facet grid). Moved verbatim out of GraphPreview.tsx
// (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4) so the component stays under its 400-line
// ceiling while gaining the encoded render: an optional per-series `styles`
// list (lib/plotEncoding's colour token + marker glyph) that the painters draw
// with. Absent `styles` paints exactly as before — `seriesColor(i)` by position
// and circle markers. A gradient Color-by (P1.4 residual 4) passes `colorBy`
// (`plotEncoding.gradientColumns`): those series paint each point through the
// Stage's own `colorscatter.colorScatterFill` / `paintColorPoint`, no line. The canvas is invisible to jsdom (no 2-D context), so
// this stays eyeball-verified; the styles it draws are unit-tested in
// lib/plotEncoding.

import { colorScatterFill, paintColorPoint, type ColorScatterSpec } from "../../../lib/colorscatter";
import type { ErrorSpan } from "../../../lib/errorbars";
import type { FacetPanel } from "../../../lib/facet";
import { FILLED_SHAPES, markerSubpaths } from "../../../lib/markers";
import type { PlotPayload } from "../../../lib/plotdata";
import type { StepMode } from "../../../lib/plotspec";
import { finiteDomain } from "../../../lib/statstage";
import type { MarkerShape, SeriesStyle } from "../../../lib/types";
import { seriesColor } from "../../../lib/uplotOpts";
import { drawErrorWhiskers } from "./errorBarsCanvas";

const MARGIN = { left: 42, right: 10, top: 10, bottom: 26 };
type Rect = { x: number; y: number; w: number; h: number };
type XYMark = "scatter" | "line" | "step";

/** Trace a step path (matplotlib's `steps-pre`/`steps-post`/`steps-mid`
 *  vocabulary — see `types.ts`'s `StepMode` doc) into an ALREADY-OPEN canvas
 *  path (caller does `beginPath`/`stroke`). Mirrors the interactive Stage's
 *  own `lib/uplotPaths.ts` (`STEPPED_PATHS`/`STEPPED_PATHS_PRE`/
 *  `STEPPED_MID_PATHS`) so the mini-preview draws the SAME shape a commit
 *  produces — a hand-rolled canvas version rather than importing uPlot here
 *  (this preview never mounts a real uPlot instance). */
function traceStep(
  ctx: CanvasRenderingContext2D,
  xs: readonly number[],
  ys: readonly number[],
  sx: (v: number) => number,
  sy: (v: number) => number,
  stepMode: StepMode,
) {
  let pen = false;
  let prevPx = 0;
  let prevPy = 0;
  for (let r = 0; r < xs.length; r++) {
    const xv = xs[r];
    const yv = ys[r];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) {
      pen = false;
      continue;
    }
    const px = sx(xv);
    const py = sy(yv);
    if (pen) {
      if (stepMode === "pre") {
        ctx.lineTo(prevPx, py);
        ctx.lineTo(px, py);
      } else if (stepMode === "mid") {
        const midX = (prevPx + px) / 2;
        ctx.lineTo(midX, prevPy);
        ctx.lineTo(midX, py);
        ctx.lineTo(px, py);
      } else {
        // "post"
        ctx.lineTo(px, prevPy);
        ctx.lineTo(px, py);
      }
    } else {
      ctx.moveTo(px, py);
    }
    prevPx = px;
    prevPy = py;
    pen = true;
  }
}

/** Draw a marker at every finite point — the shared marker pass for
 *  "scatter" (always) and "line"/"step" when markers are on. `shape` other than
 *  the default circle (P1.4 Symbol-by) uses `lib/markers.markerSubpaths`, the
 *  same glyph geometry the Stage canvas builds its marker paths from: closed
 *  glyphs fill, open ones (+ x *) stroke. */
function tracePoints(
  ctx: CanvasRenderingContext2D,
  xs: readonly number[],
  ys: readonly number[],
  sx: (v: number) => number,
  sy: (v: number) => number,
  shape: MarkerShape = "circle",
) {
  const closed = shape === "circle" || FILLED_SHAPES.has(shape);
  for (let r = 0; r < xs.length; r++) {
    const xv = xs[r];
    const yv = ys[r];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    ctx.beginPath();
    if (shape === "circle") ctx.arc(sx(xv), sy(yv), 2, 0, 2 * Math.PI);
    else {
      for (const sub of markerSubpaths(shape, sx(xv), sy(yv), 3)) {
        sub.forEach(([px, py], k) => (k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        if (closed) ctx.closePath();
      }
    }
    if (closed) ctx.fill();
    else ctx.stroke();
  }
}

function drawXYIntoRect(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  payload: PlotPayload,
  mark: XYMark,
  showMarkers: boolean,
  stepMode: StepMode,
  errorSpans?: Map<number, ErrorSpan[]>,
  label?: string,
  styles?: readonly SeriesStyle[],
  colorBy?: ReadonlyMap<number, ColorScatterSpec>,
) {
  const cols = payload.data as (number | null)[][];
  const x = (cols[0] ?? []).map((v) => (v == null ? NaN : v));
  const ys = cols.slice(1).map((c) => c.map((v) => (v == null ? NaN : v)));
  const xD = finiteDomain([x]);
  const yD = finiteDomain(ys);
  const topMargin = label ? MARGIN.top + 12 : MARGIN.top;
  const rx = rect.x + MARGIN.left;
  const ry = rect.y + topMargin;
  const rw = Math.max(1, rect.w - MARGIN.left - MARGIN.right);
  const rh = Math.max(1, rect.h - topMargin - MARGIN.bottom);

  const muted =
    typeof getComputedStyle === "function"
      ? getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#556"
      : "#556";
  const ink =
    typeof getComputedStyle === "function"
      ? getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#ddd"
      : "#ddd";
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);

  if (label) {
    ctx.fillStyle = ink;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(label, rx, rect.y);
  }

  const sx = (v: number) => rx + ((v - xD[0]) / (xD[1] - xD[0])) * rw;
  const sy = (v: number) => ry + rh - ((v - yD[0]) / (yD[1] - yD[0])) * rh;

  ys.forEach((col, i) => {
    // P1.4: an encoded series carries its level's colour token + glyph; with
    // no `styles` this is `seriesColor(i)` and circles, exactly as before.
    const style = styles?.[i];
    const color = seriesColor(i, style);
    const glyph: MarkerShape = style?.marker ? (style.markerShape ?? "circle") : "circle";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    const mapped = colorBy?.get(i + 1);
    // P1.4 gradient Color-by: each point in its own row's colour through the
    // Stage's rule (`colorScatterFill`), no line — MAIN #14's colour-mapped
    // scatter, as the Stage and the export draw it.
    if (mapped) {
      col.forEach((yv, r) => {
        const fill = Number.isFinite(x[r]) && Number.isFinite(yv) ? colorScatterFill(mapped, r) : null;
        if (fill !== null) paintColorPoint(ctx, sx(x[r]), sy(yv), 2.5, fill, mapped.shape);
      });
    } else if (mark === "line" || mark === "step") {
      // "scatter" always shows markers, no connecting line; "line"/"step" draw
      // their connector and add markers only when showMarkers is on — same
      // rule the Stage commit uses (lib/plotspec.ts's markSeriesStyle).
      ctx.beginPath();
      if (mark === "step") traceStep(ctx, x, col, sx, sy, stepMode);
      else {
        let pen = false;
        for (let r = 0; r < col.length; r++) {
          const yv = col[r];
          const xv = x[r];
          if (!Number.isFinite(xv) || !Number.isFinite(yv)) {
            pen = false;
            continue;
          }
          const px = sx(xv);
          const py = sy(yv);
          if (pen) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
          pen = true;
        }
      }
      ctx.stroke();
      if (showMarkers || style?.marker) tracePoints(ctx, x, col, sx, sy, glyph);
    } else {
      tracePoints(ctx, x, col, sx, sy, glyph);
    }
    // Error wells (#51 phase 3): same pairing specErrorBindings derives,
    // keyed like buildErrorSpans (column 0 is x, column p+1 is the p-th
    // plotted series) — `i` here IS that p.
    const spans = errorSpans?.get(i + 1);
    if (spans && spans.length > 0) drawErrorWhiskers(ctx, x, col, sx, sy, spans, color);
  });
}

/** Set up (size + clear) the canvas for one paint pass; returns the 2-D
 *  context + the host's CSS-pixel rect, or null in a headless/jsdom
 *  environment with no canvas backend. */
function setupCanvas(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
): { ctx: CanvasRenderingContext2D; W: number; H: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null; // jsdom / headless
  const W = host.clientWidth || 360;
  const H = host.clientHeight || 200;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return { ctx, W, H };
}

export function drawXY(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  payload: PlotPayload,
  mark: XYMark,
  showMarkers: boolean,
  stepMode: StepMode,
  errorSpans?: Map<number, ErrorSpan[]>,
  styles?: readonly SeriesStyle[],
  colorBy?: ReadonlyMap<number, ColorScatterSpec>,
) {
  const setup = setupCanvas(canvas, host);
  if (!setup) return;
  const { ctx, W, H } = setup;
  const rect = { x: 0, y: 0, w: W, h: H };
  drawXYIntoRect(ctx, rect, payload, mark, showMarkers, stepMode, errorSpans, undefined, styles, colorBy);
}

/** Small-multiples grid (#21 faceting): one mini xy panel per facet level,
 *  each labeled, tiled into as-square-as-possible rows/cols within the host. */
export function drawFacetGrid(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  panels: (FacetPanel & { styles?: readonly SeriesStyle[] })[], // P1.4: an encoded panel's styles
  mark: XYMark,
  showMarkers: boolean,
  stepMode: StepMode,
) {
  const setup = setupCanvas(canvas, host);
  if (!setup || panels.length === 0) return;
  const { ctx, W, H } = setup;
  const cols = Math.ceil(Math.sqrt(panels.length));
  const rows = Math.ceil(panels.length / cols);
  const cellW = W / cols;
  const cellH = H / rows;
  panels.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    drawXYIntoRect(
      ctx,
      { x: col * cellW, y: row * cellH, w: cellW, h: cellH },
      p.payload,
      mark,
      showMarkers,
      stepMode,
      undefined, // error wells degrade for faceted xy too (same gate as grouped — see plotspec.ts)
      p.label,
      p.styles,
    );
  });
}

