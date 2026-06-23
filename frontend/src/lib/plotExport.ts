// Save the current uPlot view as a PNG. uPlot draws the whole plot (series +
// axes + labels) onto one canvas but leaves the background transparent, so we
// composite it over the theme's plot background before exporting.

import type uPlot from "uplot";

import { saveBlob } from "./download";

export function exportPlotPng(u: uPlot, filename: string): void {
  const src = u.ctx.canvas;
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d");
  if (!ctx) return;
  const bg =
    getComputedStyle(document.documentElement).getPropertyValue("--axes-bg").trim() ||
    "#ffffff";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  out.toBlob((blob) => {
    if (blob) saveBlob(blob, filename);
  }, "image/png");
}
