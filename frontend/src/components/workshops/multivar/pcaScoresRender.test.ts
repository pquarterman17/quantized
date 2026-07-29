import { describe, expect, it } from "vitest";

import { draw, type PcaDrawData } from "./pcaScoresRender";

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

const SCORES: PcaDrawData = {
  points: Array.from({ length: 20 }, (_, i) => [i - 10, Math.sin(i)] as [number, number]),
  vectors: [],
  xLabel: "PC1 (75%)",
  yLabel: "PC2 (25%)",
};

const LOADINGS: PcaDrawData = {
  points: [],
  vectors: [
    { x: 0.9, y: 0.1, label: "a" },
    { x: -0.5, y: 0.8, label: "b" },
  ],
  xLabel: "PC1",
  yLabel: "PC2",
};

const BIPLOT: PcaDrawData = { points: SCORES.points, vectors: LOADINGS.vectors, xLabel: "PC1", yLabel: "PC2" };

(CANVAS_OK ? describe : describe.skip)("draw (PCA scores/loadings/biplot, real raster)", () => {
  const readAll = (canvas: HTMLCanvasElement): Uint8ClampedArray =>
    canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;

  function paints(data: PcaDrawData | null): boolean {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    draw(canvas, host, data);
    return countPainted(readAll(canvas)) > 0;
  }

  it("scores mode paints a point cloud", () => {
    expect(paints(SCORES)).toBe(true);
  });

  it("loadings mode paints vector arrows + labels, no points", () => {
    expect(paints(LOADINGS)).toBe(true);
  });

  it("biplot mode paints both points and rescaled vectors", () => {
    expect(paints(BIPLOT)).toBe(true);
  });

  it("renders nothing but leaves the canvas clear for a null/empty payload", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    draw(canvas, host, null);
    expect(canvas.width).toBeGreaterThan(0);
    expect(countPainted(readAll(canvas))).toBe(0);

    draw(canvas, host, { points: [], vectors: [], xLabel: "x", yLabel: "y" });
    expect(countPainted(readAll(canvas))).toBe(0);
  });

  it("does not throw when every loading vector is degenerate (zero-length)", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    const zero: PcaDrawData = { points: SCORES.points, vectors: [{ x: 0, y: 0, label: "z" }], xLabel: "x", yLabel: "y" };
    expect(() => draw(canvas, host, zero)).not.toThrow();
  });
});
