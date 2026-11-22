// Heat-map preview of a spectrogram table (time across, frequency up, colour =
// the scaled spectrum). Drawn on a canvas at the display size so a million-cell
// result stays cheap; the numbers it summarises are written out as text too.

import { useEffect, useRef } from "react";

import { colormap } from "../../../lib/colormap";
import type { DataStruct } from "../../../lib/types";
import { spectrogramGrid } from "./spectrogramModel";

const W = 460;
const H = 160;

const fmt = (v: number): string => (Number.isFinite(v) ? Number(v.toPrecision(4)).toString() : "n/a");

export default function SpectrogramPreview({ data }: { data: DataStruct }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const grid = spectrogramGrid(data);
  let zMin = Infinity;
  let zMax = -Infinity;
  if (grid) {
    for (const row of data.values) {
      const z = row[1];
      if (typeof z === "number" && Number.isFinite(z)) {
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
      }
    }
  }
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d") ?? null; // jsdom has no canvas: the text below still reports the result
    if (!el || !ctx || !grid) return;
    const img = ctx.createImageData(W, H);
    const span = zMax - zMin || 1;
    for (let py = 0; py < H; py++) {
      const f = Math.min(grid.frequencies - 1, Math.floor(((H - 1 - py) / H) * grid.frequencies));
      for (let px = 0; px < W; px++) {
        const s = Math.min(grid.segments - 1, Math.floor((px / W) * grid.segments));
        const z = data.values[s * grid.frequencies + f]?.[1];
        const at = (py * W + px) * 4;
        if (typeof z !== "number" || !Number.isFinite(z)) { img.data[at + 3] = 0; continue; }
        const [r, g, b] = colormap("viridis", (z - zMin) / span);
        img.data[at] = r; img.data[at + 1] = g; img.data[at + 2] = b; img.data[at + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [data, grid, zMin, zMax]);
  if (!grid) return null;
  const t0 = data.time[0];
  const t1 = data.time[data.time.length - 1];
  const fMax = data.values[grid.frequencies - 1]?.[0] ?? NaN;
  return (
    <div className="qz-signal-preview">
      <canvas ref={canvas} width={W} height={H} role="img" className="qz-spectrogram-canvas" aria-label="Spectrogram preview" />
      <div className="qz-signal-preview-key">
        <span className="qz-signal-preview-name">Preview: {data.labels[1]}</span>
        <span>{grid.segments.toLocaleString()} segments × {grid.frequencies.toLocaleString()} frequencies</span>
        <span className="qz-num">time {fmt(t0 ?? NaN)} to {fmt(t1 ?? NaN)}</span>
        <span className="qz-num">frequency 0 to {fmt(fMax)}{data.units[0] ? ` ${data.units[0]}` : ""}</span>
        <span className="qz-num">value {fmt(zMin)} to {fmt(zMax)}{data.units[1] ? ` ${data.units[1]}` : ""}</span>
      </div>
    </div>
  );
}
