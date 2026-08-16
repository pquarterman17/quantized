import type { DataStruct } from "./types";
import type { ThumbnailResult } from "./thumbnailCache";

export const THUMB_W = 320;
export const THUMB_H = 180;
export const THUMB_PALETTE = ["#6d5bd0", "#0f9d8a", "#e47b38", "#2878b5"] as const;

export function escapeSvg(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function svgResult(body: string, label = ""): ThumbnailResult {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_W}" height="${THUMB_H}" viewBox="0 0 ${THUMB_W} ${THUMB_H}" role="img" aria-label="${escapeSvg(label)}">${body}</svg>`;
  return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, width: THUMB_W, height: THUMB_H };
}

export function plotSvgBody(
  data: DataStruct | null | undefined,
  xKey: number | null | undefined,
  yKeys: readonly number[] | null | undefined,
  box = { x: 18, y: 12, width: 284, height: 146 },
): string {
  const xIndex = xKey ?? -1;
  const available = data?.values[0]?.length ?? 0;
  const keys = (yKeys?.length ? [...yKeys] : Array.from({ length: Math.min(3, available) }, (_, i) => i))
    .filter((key) => key >= 0 && key < available && key !== xIndex)
    .slice(0, 4);
  const rows = data?.values ?? [];
  if (!data || rows.length < 2 || keys.length === 0) return emptyPlotBody(box, "No plottable data");

  const indices = rows.length > 180
    ? Array.from({ length: 180 }, (_, i) => Math.round(i * (rows.length - 1) / 179))
    : rows.map((_, i) => i);
  const sampled = indices.map((index) => rows[index]);
  const xs = sampled.map((row, i) => xIndex >= 0 ? row[xIndex] : (data.time[indices[i]] ?? indices[i]));
  const finiteX = xs.filter(Number.isFinite);
  const finiteY = sampled.flatMap((row) => keys.map((key) => row[key])).filter(Number.isFinite);
  if (finiteX.length < 2 || finiteY.length < 2) return emptyPlotBody(box, "No finite data");
  const [xmin, xmax] = extent(finiteX);
  const [ymin, ymax] = extent(finiteY);
  const sx = (value: number) => box.x + ((value - xmin) / (xmax - xmin || 1)) * box.width;
  const sy = (value: number) => box.y + box.height - ((value - ymin) / (ymax - ymin || 1)) * box.height;
  const series = keys.map((key, seriesIndex) => {
    const points = sampled.flatMap((row, i) => Number.isFinite(xs[i]) && Number.isFinite(row[key])
      ? [`${sx(xs[i]).toFixed(1)},${sy(row[key]).toFixed(1)}`]
      : []);
    return `<polyline points="${points.join(" ")}" fill="none" stroke="${THUMB_PALETTE[seriesIndex % THUMB_PALETTE.length]}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join("");
  return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="#ffffff"/><path d="M${box.x} ${box.y}V${box.y + box.height}H${box.x + box.width}" fill="none" stroke="#a9b3c1" stroke-width="1.2"/>${series}`;
}

function emptyPlotBody(box: { x: number; y: number; width: number; height: number }, message: string): string {
  return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="#f4f6f9" stroke="#d6dce5" stroke-dasharray="4 3"/><text x="${box.x + box.width / 2}" y="${box.y + box.height / 2}" text-anchor="middle" fill="#6d7785" font-family="system-ui,sans-serif" font-size="12">${escapeSvg(message)}</text>`;
}

function extent(values: readonly number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === max) return [min - 0.5, max + 0.5];
  return [min, max];
}
