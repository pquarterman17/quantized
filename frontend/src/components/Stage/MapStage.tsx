// 2-D map viewer: a Canvas2D heatmap of three scattered channels (x, y, z)
// regridded onto a regular grid (backend /api/plot/map, client fallback). The
// grid is painted to an offscreen nx×ny canvas then blitted scaled — one GPU
// up-scale instead of nx·ny rects. NaN cells (outside the data hull) are
// transparent (gaps), matching uPlot's null = gap for 1-D.

import { useEffect, useRef, useState } from "react";

import { COLORMAPS, type ColormapName, colormapCss, normalize, sampleColormap } from "../../lib/colormap";
import { fetchMap, type MapPayload } from "../../lib/mapdata";
import { useActiveDataset, useApp } from "../../store/useApp";

const MARGIN = { left: 58, right: 78, top: 14, bottom: 42 };

interface Readout {
  x: number;
  y: number;
  z: number | null;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
}

export default function MapStage() {
  const active = useActiveDataset();
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [payload, setPayload] = useState<MapPayload | null>(null);
  const [cmap, setCmap] = useState<ColormapName>("viridis");
  const [logZ, setLogZ] = useState(false);
  const [readout, setReadout] = useState<Readout | null>(null);
  // x/y/z channel picks, local to this view (default the first three channels).
  const [keys, setKeys] = useState<[number, number, number]>([0, 1, 2]);

  const labels = active?.data.labels ?? [];
  const enoughChannels = labels.length >= 3;

  // Reset the channel picks to 0/1/2 when the active dataset changes.
  useEffect(() => {
    setKeys([0, 1, Math.min(2, Math.max(0, labels.length - 1))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // Fetch + regrid whenever the dataset or channel picks change.
  useEffect(() => {
    let cancelled = false;
    if (!active || !enoughChannels) {
      setPayload(null);
      return;
    }
    fetchMap(active.data, keys[0], keys[1], keys[2]).then((p) => {
      if (!cancelled) setPayload(p);
    });
    return () => {
      cancelled = true;
    };
  }, [active, enoughChannels, keys]);

  // (Re)paint the canvas when the grid / colormap / theme / size change.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const paint = () => draw(canvas, host, payload, cmap, logZ);
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
    // theme/accent in deps so the frame/axis ink recolors from fresh tokens.
  }, [payload, cmap, logZ, theme, accent]);

  function onMove(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (!payload) return;
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const rect = canvas.getBoundingClientRect();
    const r = hitTest(payload, host.clientWidth, host.clientHeight, ev.clientX - rect.left, ev.clientY - rect.top);
    setReadout(r);
  }

  return (
    <div className="qzk-stage">
      <div ref={hostRef} style={{ position: "absolute", inset: 8 }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
          onMouseMove={onMove}
          onMouseLeave={() => setReadout(null)}
        />
      </div>

      {active && enoughChannels && (
        <div className="qzk-glass qzk-float-tools" style={{ gap: 8, padding: "6px 8px" }}>
          {(["X", "Y", "Z"] as const).map((axis, slot) => (
            <label key={axis} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              {axis}
              <select
                value={keys[slot]}
                onChange={(e) =>
                  setKeys((k) => {
                    const next = [...k] as [number, number, number];
                    next[slot] = Number(e.target.value);
                    return next;
                  })
                }
              >
                {labels.map((lab, i) => (
                  <option key={i} value={i}>
                    {lab}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <span className="qzk-tool-sep" />
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
            map
            <select value={cmap} onChange={(e) => setCmap(e.target.value as ColormapName)}>
              {Object.keys(COLORMAPS).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button
            className={`qzk-tool-btn${logZ ? " active" : ""}`}
            title="Log intensity scale (for high-dynamic-range data like RSM)"
            onClick={() => setLogZ((v) => !v)}
          >
            log
          </button>
        </div>
      )}

      {!active && (
        <div className="qzk-ds-meta" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          Select a dataset to map
        </div>
      )}
      {active && !enoughChannels && (
        <div className="qzk-ds-meta" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
          A 2-D map needs at least 3 channels (x, y, z).
          <br />
          This dataset has {labels.length}.
        </div>
      )}

      {readout && (
        <div className="qzk-glass qzk-readout">
          {fmt(readout.x)}, {fmt(readout.y)} : {readout.z == null ? "—" : fmt(readout.z)}
        </div>
      )}
    </div>
  );
}

// ── Canvas rendering (pure of React; reads CSS tokens for theme-aware ink) ──

function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== "function") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Plot-area rectangle (inside the axis/colorbar margins), in CSS px. */
function plotRect(w: number, h: number) {
  return {
    x: MARGIN.left,
    y: MARGIN.top,
    w: Math.max(1, w - MARGIN.left - MARGIN.right),
    h: Math.max(1, h - MARGIN.top - MARGIN.bottom),
  };
}

/** Map a pointer position to (x, y, z) at the nearest grid cell, or null if the
 *  pointer is outside the plot area. Exported shape mirrors the canvas math so a
 *  test could exercise it without a real 2-D context. */
function hitTest(p: MapPayload, w: number, h: number, px: number, py: number): Readout | null {
  const rect = plotRect(w, h);
  if (px < rect.x || px > rect.x + rect.w || py < rect.y || py > rect.y + rect.h) return null;
  const { xAxis, yAxis, zGrid } = p;
  const xmin = xAxis[0];
  const xmax = xAxis[xAxis.length - 1];
  const ymin = yAxis[0];
  const ymax = yAxis[yAxis.length - 1];
  const fx = (px - rect.x) / rect.w;
  const fy = (py - rect.y) / rect.h;
  const x = xmin + fx * (xmax - xmin);
  const y = ymax - fy * (ymax - ymin); // screen y is top-down; data y is bottom-up
  const i = Math.max(0, Math.min(xAxis.length - 1, Math.round(fx * (xAxis.length - 1))));
  const j = Math.max(0, Math.min(yAxis.length - 1, Math.round((1 - fy) * (yAxis.length - 1))));
  return { x, y, z: zGrid[j]?.[i] ?? null };
}

/** Smallest strictly-positive finite cell (the log-scale colour floor). */
function minPositive(grid: (number | null)[][]): number | null {
  let lo = Infinity;
  for (const row of grid) {
    for (const v of row) {
      if (v != null && Number.isFinite(v) && v > 0 && v < lo) lo = v;
    }
  }
  return Number.isFinite(lo) ? lo : null;
}

function draw(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  p: MapPayload | null,
  cmap: ColormapName,
  logZ: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return; // jsdom / headless — nothing to paint
  const W = host.clientWidth || 600;
  const H = host.clientHeight || 400;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!p) return;

  const ink = cssVar("--text", "#e6e6e6");
  const muted = cssVar("--text-dim", "#9aa");
  const rect = plotRect(W, H);
  // Log mode floors at the smallest positive cell (0/negative -> transparent).
  const lo = logZ ? minPositive(p.zGrid) : p.zMin;
  const hi = p.zMax;
  const stops = COLORMAPS[cmap];

  // Offscreen nx×ny image, then one scaled blit (vertically flipped: image row 0
  // is the top = max y).
  if (lo != null && hi != null && hi > lo) {
    const nx = p.xAxis.length;
    const ny = p.yAxis.length;
    const off = document.createElement("canvas");
    off.width = nx;
    off.height = ny;
    const octx = off.getContext("2d");
    if (octx) {
      const img = octx.createImageData(nx, ny);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const v = p.zGrid[j]?.[i];
          const px = ((ny - 1 - j) * nx + i) * 4;
          const t = v == null ? null : normalize(v, lo, hi, logZ);
          if (t == null) {
            img.data[px + 3] = 0;
            continue;
          }
          const [r, g, b] = sampleColormap(stops, t);
          img.data[px] = r;
          img.data[px + 1] = g;
          img.data[px + 2] = b;
          img.data[px + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h);
    }
  }

  // Plot border.
  ctx.strokeStyle = muted;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);

  drawAxes(ctx, p, rect, ink, muted);
  drawColorbar(ctx, p, rect, W, cmap, lo, hi, logZ, ink, muted);
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  p: MapPayload,
  rect: { x: number; y: number; w: number; h: number },
  ink: string,
  muted: string,
) {
  const xmin = p.xAxis[0];
  const xmax = p.xAxis[p.xAxis.length - 1];
  const ymin = p.yAxis[0];
  const ymax = p.yAxis[p.yAxis.length - 1];
  ctx.fillStyle = muted;
  ctx.strokeStyle = muted;
  ctx.font = "10px 'JetBrains Mono', monospace";
  const NT = 5;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let t = 0; t < NT; t++) {
    const f = t / (NT - 1);
    const sx = rect.x + f * rect.w;
    ctx.beginPath();
    ctx.moveTo(sx, rect.y + rect.h);
    ctx.lineTo(sx, rect.y + rect.h + 4);
    ctx.stroke();
    ctx.fillText(fmt(xmin + f * (xmax - xmin)), sx, rect.y + rect.h + 6);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let t = 0; t < NT; t++) {
    const f = t / (NT - 1);
    const sy = rect.y + rect.h - f * rect.h;
    ctx.beginPath();
    ctx.moveTo(rect.x - 4, sy);
    ctx.lineTo(rect.x, sy);
    ctx.stroke();
    ctx.fillText(fmt(ymin + f * (ymax - ymin)), rect.x - 7, sy);
  }
  // Axis titles.
  ctx.fillStyle = ink;
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const xt = p.xUnit ? `${p.xLabel} (${p.xUnit})` : p.xLabel;
  ctx.fillText(xt, rect.x + rect.w / 2, rect.y + rect.h + 38);
  ctx.save();
  ctx.translate(12, rect.y + rect.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  const yt = p.yUnit ? `${p.yLabel} (${p.yUnit})` : p.yLabel;
  ctx.fillText(yt, 0, 0);
  ctx.restore();
}

function drawColorbar(
  ctx: CanvasRenderingContext2D,
  p: MapPayload,
  rect: { x: number; y: number; w: number; h: number },
  W: number,
  cmap: ColormapName,
  lo: number | null,
  hi: number | null,
  logZ: boolean,
  ink: string,
  muted: string,
) {
  const bx = W - MARGIN.right + 16;
  const bw = 14;
  const grad = ctx.createLinearGradient(0, rect.y + rect.h, 0, rect.y);
  for (let s = 0; s <= 8; s++) grad.addColorStop(s / 8, colormapCss(cmap, s / 8));
  ctx.fillStyle = grad;
  ctx.fillRect(bx, rect.y, bw, rect.h);
  ctx.strokeStyle = muted;
  ctx.strokeRect(bx + 0.5, rect.y + 0.5, bw, rect.h);

  // Endpoint labels show the effective colour range (the log floor when on).
  ctx.fillStyle = muted;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if (hi != null) ctx.fillText(fmt(hi), bx + bw + 4, rect.y);
  if (lo != null) ctx.fillText(fmt(lo), bx + bw + 4, rect.y + rect.h);
  ctx.fillStyle = ink;
  ctx.save();
  ctx.translate(bx + bw + 30, rect.y + rect.h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const base = p.zUnit ? `${p.zLabel} (${p.zUnit})` : p.zLabel;
  ctx.fillText(logZ ? `${base} — log` : base, 0, 0);
  ctx.restore();
}
