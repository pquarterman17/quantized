// Heat-map preview of a CWT scalogram (a native-grid map DataStruct: rows run
// y-outer, x-inner, `metadata.map_shape` = [ny, nx]; columns X, axis, |W|). X
// across, the scale or frequency axis up. Drawn on a canvas at the display size
// so a large result stays cheap; the numbers it summarises are written as text.

import { useEffect, useRef } from "react";

import { colormap } from "../../../lib/colormap";
import { fmtInt } from "../../../lib/locale";
import type { DataStruct } from "../../../lib/types";

const W = 460;
const H = 160;

const fmt = (v: number): string => (Number.isFinite(v) ? Number(v.toPrecision(4)).toString() : "n/a");

/** `[ny, nx]` of a native-grid map result, or null when `data` is not one. */
export function scalogramShape(data: DataStruct): [number, number] | null {
  const s = data.metadata["map_shape"];
  if (!Array.isArray(s) || s.length !== 2 || data.metadata["map_grid"] !== "native") return null;
  const [ny, nx] = [Number(s[0]), Number(s[1])];
  return Number.isInteger(ny) && Number.isInteger(nx) && ny >= 1 && nx >= 1 && ny * nx === data.values.length ? [ny, nx] : null;
}

export default function ScalogramPreview({ data }: { data: DataStruct }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shape = scalogramShape(data);
  let zMin = Infinity;
  let zMax = -Infinity;
  if (shape) {
    for (const row of data.values) {
      const z = row[2];
      if (typeof z === "number" && Number.isFinite(z)) {
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
      }
    }
  }
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d") ?? null; // jsdom has no canvas: the text below still reports the result
    if (!el || !ctx || !shape) return;
    const [ny, nx] = shape;
    const img = ctx.createImageData(W, H);
    const span = zMax - zMin || 1;
    for (let py = 0; py < H; py++) {
      const j = Math.min(ny - 1, Math.floor(((H - 1 - py) / H) * ny));
      for (let px = 0; px < W; px++) {
        const i = Math.min(nx - 1, Math.floor((px / W) * nx));
        const z = data.values[j * nx + i]?.[2];
        const at = (py * W + px) * 4;
        if (typeof z !== "number" || !Number.isFinite(z)) { img.data[at + 3] = 0; continue; }
        const [r, g, b] = colormap("viridis", (z - zMin) / span);
        img.data[at] = r; img.data[at + 1] = g; img.data[at + 2] = b; img.data[at + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [data, shape, zMin, zMax]);
  if (!shape) return null;
  const [ny, nx] = shape;
  const axisLabel = data.labels[1] ?? "axis";
  const unit = (i: number): string => (data.units[i] ? ` ${data.units[i]}` : "");
  return (
    <div className="qz-signal-preview">
      <canvas ref={canvas} width={W} height={H} role="img" className="qz-spectrogram-canvas" aria-label="Scalogram preview" />
      <div className="qz-signal-preview-key">
        <span className="qz-signal-preview-name">Preview: scalogram |W|</span>
        <span>{fmtInt(nx)} points × {fmtInt(ny)} {axisLabel.toLowerCase()} rows</span>
        <span className="qz-num">{axisLabel} {fmt(data.values[0]?.[1] ?? NaN)} to {fmt(data.values[(ny - 1) * nx]?.[1] ?? NaN)}{unit(1)}</span>
        <span className="qz-num">value {fmt(zMin)} to {fmt(zMax)}{unit(2)}</span>
      </div>
    </div>
  );
}
