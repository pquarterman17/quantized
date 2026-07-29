import { describe, expect, it } from "vitest";

import { draw, type SplomDrawData } from "./splomRender";

// Real-raster verification (statRender.test.ts's precedent): run the full
// draw() pipeline against an actual canvas raster and read back pixels.
// Skips cleanly where no canvas backend is available so CI stays green even
// without the optional native dep.
const CANVAS_OK = ((): boolean => {
  try {
    return document.createElement("canvas").getContext("2d") != null;
  } catch {
    return false;
  }
})();

function countPainted(img: Uint8ClampedArray): number {
  let n = 0;
  for (let k = 0; k < img.length; k += 4) {
    if (img[k + 3] > 0 && img[k] + img[k + 1] + img[k + 2] > 0) n++;
  }
  return n;
}

const ROWS: SplomDrawData = {
  labels: ["a", "b", "c"],
  rows: Array.from({ length: 40 }, (_, i) => [i, 40 - i, (i % 5) * 2]),
};

(CANVAS_OK ? describe : describe.skip)("draw (SPLOM, real raster)", () => {
  const readAll = (canvas: HTMLCanvasElement): Uint8ClampedArray =>
    canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;

  function paints(data: SplomDrawData | null): boolean {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    draw(canvas, host, data);
    return countPainted(readAll(canvas)) > 0;
  }

  it("paints the n×n grid (borders + scatter + diagonal histograms)", () => {
    expect(paints(ROWS)).toBe(true);
  });

  it("renders nothing but leaves the canvas clear for a null payload", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    draw(canvas, host, null);
    expect(canvas.width).toBeGreaterThan(0);
    expect(countPainted(readAll(canvas))).toBe(0);
  });

  it("does not throw with fewer than 2 columns (defensive guard) and paints nothing", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    expect(() => draw(canvas, host, { labels: ["a"], rows: [[1], [2]] })).not.toThrow();
    expect(countPainted(readAll(canvas))).toBe(0);
  });

  it("does not throw on zero rows (defensive guard)", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    expect(() => draw(canvas, host, { labels: ["a", "b"], rows: [] })).not.toThrow();
  });

  it("does not throw on a constant column (degenerate domain)", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    const constant: SplomDrawData = { labels: ["a", "b"], rows: Array.from({ length: 10 }, () => [5, 5]) };
    expect(() => draw(canvas, host, constant)).not.toThrow();
  });
});
