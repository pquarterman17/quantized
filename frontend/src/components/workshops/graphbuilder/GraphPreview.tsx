// Graph Builder live mini-preview. box/violin reuse the #16 stat renderer
// (Stage/statRender.ts); scatter/line paint a compact Canvas2D scatter/line from
// the specToRender PlotPayload. A "message" render shows its text instead. The
// canvas is invisible to jsdom (no layout / 2-D context), so this component is
// eyeball-verified — the grammar it draws from is unit-tested in lib/plotspec.

import { useEffect, useRef } from "react";

import { finiteDomain } from "../../../lib/statstage";
import type { PlotPayload } from "../../../lib/plotdata";
import type { SpecRender } from "../../../lib/plotspec";
import { seriesColor } from "../../../lib/uplotOpts";
import { useApp } from "../../../store/useApp";
import { draw as drawStat } from "../../Stage/statRender";

const MARGIN = { left: 42, right: 10, top: 10, bottom: 26 };

function drawXY(canvas: HTMLCanvasElement, host: HTMLElement, payload: PlotPayload, mark: "scatter" | "line") {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // jsdom / headless
  const W = host.clientWidth || 360;
  const H = host.clientHeight || 200;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const cols = payload.data as (number | null)[][];
  const x = (cols[0] ?? []).map((v) => (v == null ? NaN : v));
  const ys = cols.slice(1).map((c) => c.map((v) => (v == null ? NaN : v)));
  const xD = finiteDomain([x]);
  const yD = finiteDomain(ys);
  const rx = MARGIN.left;
  const ry = MARGIN.top;
  const rw = Math.max(1, W - MARGIN.left - MARGIN.right);
  const rh = Math.max(1, H - MARGIN.top - MARGIN.bottom);

  const muted =
    typeof getComputedStyle === "function"
      ? getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#556"
      : "#556";
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);

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

export default function GraphPreview({ render }: { render: SpecRender }) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const paint = () => {
      if (render.kind === "xy") drawXY(canvas, host, render.payload, render.mark);
      else if (render.kind === "box")
        drawStat(canvas, host, {
          mode: "box",
          boxes: render.boxes,
          valueLabel: render.valueLabel,
          groupLabel: render.groupLabel,
        });
      else {
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
    <div className="qzk-graph-preview">
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
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
