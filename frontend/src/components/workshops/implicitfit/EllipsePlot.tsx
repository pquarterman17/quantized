// Equal-aspect canvas for the ellipse fit: the points and the fitted curve on
// one set of axes whose scales match (an ellipse drawn on stretched axes would
// misstate its shape), with the centre marked. Colours are read from the
// design tokens at draw time.

import { useEffect, useRef } from "react";

import { useApp } from "../../../store/useApp";

interface Props {
  x: number[];
  y: number[];
  curveX: number[];
  curveY: number[];
  center: [number, number];
  height?: number;
}

export default function EllipsePlot({ x, y, curveX, curveY, center, height = 220 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth || 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    const css = getComputedStyle(canvas);
    const ink = css.getPropertyValue("--series-1").trim() || css.getPropertyValue("--text").trim();
    const line = css.getPropertyValue("--accent").trim() || ink;

    const xs = [...x, ...curveX];
    const ys = [...y, ...curveY];
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = 12;
    // One scale for both axes: the larger of the two data spans fills the canvas.
    const k = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-300), (height - 2 * pad) / Math.max(y1 - y0, 1e-300));
    const ox = (w - (x1 - x0) * k) / 2;
    const oy = (height - (y1 - y0) * k) / 2;
    const px = (v: number): number => ox + (v - x0) * k;
    const py = (v: number): number => height - oy - (v - y0) * k;

    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.75;
    for (let i = 0; i < x.length; i++) {
      ctx.beginPath();
      ctx.arc(px(x[i]), py(y[i]), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    curveX.forEach((v, i) => (i === 0 ? ctx.moveTo(px(v), py(curveY[i])) : ctx.lineTo(px(v), py(curveY[i]))));
    ctx.stroke();
    ctx.lineWidth = 1.5;
    const cx = px(center[0]), cy = py(center[1]);
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx + 5, cy);
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx, cy + 5);
    ctx.stroke();
  }, [x, y, curveX, curveY, center, height, theme, accent]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="Data points with the fitted ellipse and its centre, drawn with equal axis scales"
      style={{ width: "100%", height, border: "1px solid var(--border)", borderRadius: "var(--radius-sm, 4px)" }}
    />
  );
}
