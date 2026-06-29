// Save the current uPlot view as a PNG. uPlot draws the whole plot (series +
// axes + labels) onto one canvas but leaves the background transparent, so we
// composite it over the theme's plot background before exporting.

import type uPlot from "uplot";

import { saveBlob } from "./download";

export function exportPlotPng(u: uPlot, filename: string): void {
  exportCanvasPng(u.ctx.canvas, filename);
}

/** Composite a (transparent-background) canvas over the theme plot background into
 *  a fresh canvas (null if a 2-D context is unavailable). Shared by the PNG export
 *  and the clipboard snapshot so both render identical pixels. */
function compositeOverBg(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d");
  if (!ctx) return null;
  const bg =
    getComputedStyle(document.documentElement).getPropertyValue("--axes-bg").trim() ||
    "#ffffff";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  return out;
}

/** Composite a (transparent-background) canvas over the theme plot background and
 *  save it as a PNG. Used by the uPlot export and the 2-D map (Canvas2D) view. */
export function exportCanvasPng(src: HTMLCanvasElement, filename: string): void {
  const out = compositeOverBg(src);
  if (!out) return;
  out.toBlob((blob) => {
    if (blob) saveBlob(blob, filename);
  }, "image/png");
}

/** The current uPlot view composited over the theme background, as a PNG Blob
 *  (null if the canvas can't be composited / encoded). Used by the clipboard
 *  snapshot (⎘) — a quick raster grab of exactly what's on screen. */
export function plotPngBlob(u: uPlot): Promise<Blob | null> {
  const out = compositeOverBg(u.ctx.canvas);
  if (!out) return Promise.resolve(null);
  return new Promise((resolve) => out.toBlob((blob) => resolve(blob), "image/png"));
}
