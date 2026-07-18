// Graph Builder live mini-preview. box/violin/bar reuse the #16/#20 stat
// renderer (Stage/statRender.ts); scatter/line paint a compact Canvas2D
// scatter/line from the specToRender PlotPayload — one panel normally, or a
// small-multiples GRID when the spec's facet zone is set (#21 faceting,
// lib/facet.facetPayloads; see plotspec.ts's `SpecRender.facets`). box/bar
// facet the SAME way (GUI_INTERACTION #11 residual) but render differently:
// the xy grid paints every panel onto ONE shared canvas (`drawFacetGrid`),
// while box/bar tile N independent `StatStageCanvas`es (`FacetStatGrid`
// below) — mirroring the live Stat Stage's own facet grid so the two stay
// visually consistent. A "message" render shows its text instead. The canvas
// is invisible to jsdom (no layout / 2-D context), so this component is
// eyeball-verified — the grammar it draws from is unit-tested in
// lib/plotspec + lib/facet.

import { useEffect, useRef } from "react";

import type { FacetPanel } from "../../../lib/facet";
import type { PlotPayload } from "../../../lib/plotdata";
import type { SpecRender } from "../../../lib/plotspec";
import { finiteDomain } from "../../../lib/statstage";
import { seriesColor } from "../../../lib/uplotOpts";
import type { Accent, Theme } from "../../../store/useApp";
import { useApp } from "../../../store/useApp";
import StatStageCanvas from "../../Stage/StatStageCanvas";
import { draw as drawStat, type StatDrawData } from "../../Stage/statRender";

const MARGIN = { left: 42, right: 10, top: 10, bottom: 26 };

type Rect = { x: number; y: number; w: number; h: number };

function drawXYIntoRect(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  payload: PlotPayload,
  mark: "scatter" | "line",
  label?: string,
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
    const color = seriesColor(i);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    if (mark === "line") {
      ctx.beginPath();
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
      ctx.stroke();
    } else {
      for (let r = 0; r < col.length; r++) {
        const yv = col[r];
        const xv = x[r];
        if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
        ctx.beginPath();
        ctx.arc(sx(xv), sy(yv), 2, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
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

function drawXY(canvas: HTMLCanvasElement, host: HTMLElement, payload: PlotPayload, mark: "scatter" | "line") {
  const setup = setupCanvas(canvas, host);
  if (!setup) return;
  const { ctx, W, H } = setup;
  drawXYIntoRect(ctx, { x: 0, y: 0, w: W, h: H }, payload, mark);
}

/** Small-multiples grid (#21 faceting): one mini xy panel per facet level,
 *  each labeled, tiled into as-square-as-possible rows/cols within the host. */
function drawFacetGrid(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  panels: FacetPanel[],
  mark: "scatter" | "line",
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
    drawXYIntoRect(ctx, { x: col * cellW, y: row * cellH, w: cellW, h: cellH }, p.payload, mark, p.label);
  });
}

/** The single-panel canvas host (xy incl. its own facet grid, flat box/bar,
 *  message). Owns the ONE canvas + its paint effect — unchanged from before
 *  #11's box/bar facet grid split it out of the default export. */
function CanvasHost({ render, theme, accent }: { render: SpecRender; theme: Theme; accent: Accent }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const paint = () => {
      if (render.kind === "xy") {
        if (render.facets && render.facets.length > 0) {
          drawFacetGrid(canvas, host, render.facets, render.mark);
        } else {
          drawXY(canvas, host, render.payload, render.mark);
        }
      } else if (render.kind === "box") {
        drawStat(canvas, host, {
          mode: "box",
          boxes: render.boxes,
          valueLabel: render.valueLabel,
          groupLabel: render.groupLabel,
        });
      } else if (render.kind === "bar") {
        drawStat(canvas, host, {
          mode: "bar",
          data: render.data,
          valueLabel: render.valueLabel,
          groupLabel: render.groupLabel,
          stacked: render.stacked,
        });
      } else {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
  }, [render, theme, accent]);

  return (
    <div ref={hostRef} style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

/** A CSS grid of independent, DOM-captioned `StatStageCanvas` cells — the
 *  shared tiling both box-facets and bar-facets use below (#11). Mirrors
 *  StatStage.tsx's own facet grid so the builder preview and the live stage
 *  read the same. */
function FacetCellGrid({
  cells,
  theme,
  accent,
}: {
  cells: { label: string; draw: StatDrawData }[];
  theme: Theme;
  accent: Accent;
}) {
  const cols = Math.ceil(Math.sqrt(cells.length));
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", gap: 4, gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {cells.map((c) => (
        <div key={c.label} style={{ position: "relative", display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 9,
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--text-dim)",
              padding: "0 2px",
            }}
          >
            {c.label}
          </div>
          <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
            <StatStageCanvas data={c.draw} theme={theme} accent={accent} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Faceted box/bar (#11): one small `StatStageCanvas` per facet level instead
 *  of the single shared canvas `CanvasHost` paints — each cell built via the
 *  SAME draw-arg shape the flat `CanvasHost` box/bar branches construct
 *  above, just per facet slice. Narrows on `render.kind` once (not per cell)
 *  so each branch's `facets` element type stays concrete. */
function FacetStatGrid({
  render,
  theme,
  accent,
}: {
  render: Extract<SpecRender, { kind: "box" | "bar" }>;
  theme: Theme;
  accent: Accent;
}) {
  if (render.kind === "box") {
    const cells = (render.facets ?? []).map((f) => ({
      label: f.label,
      draw: { mode: "box", boxes: f.boxes, valueLabel: render.valueLabel, groupLabel: render.groupLabel } as StatDrawData,
    }));
    return <FacetCellGrid cells={cells} theme={theme} accent={accent} />;
  }
  const cells = (render.facets ?? []).map((f) => ({
    label: f.label,
    draw: {
      mode: "bar",
      data: f.data,
      valueLabel: render.valueLabel,
      groupLabel: render.groupLabel,
      stacked: render.stacked,
    } as StatDrawData,
  }));
  return <FacetCellGrid cells={cells} theme={theme} accent={accent} />;
}

export default function GraphPreview({ render }: { render: SpecRender }) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);

  return (
    <div className="qzk-graph-preview">
      {(render.kind === "box" || render.kind === "bar") && render.facets && render.facets.length > 0 ? (
        <FacetStatGrid render={render} theme={theme} accent={accent} />
      ) : (
        <CanvasHost render={render} theme={theme} accent={accent} />
      )}
      {render.kind === "message" && (
        <div className={`qzk-graph-preview-msg${render.tone === "note" ? " note" : ""}`}>
          {render.message}
        </div>
      )}
      {render.kind === "box" && render.violin && (
        <div className="qzk-graph-preview-approx">violin preview shows box · KDE renders on Send to Stage</div>
      )}
    </div>
  );
}
