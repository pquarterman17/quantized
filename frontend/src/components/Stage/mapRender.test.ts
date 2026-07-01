import { describe, expect, it } from "vitest";

import type { MapPayload } from "../../lib/mapdata";
import type { RsmPeak } from "../../lib/types";
import { buildHeatmapImage, draw, fmt, hitTest, minPositive, peakMarkerXY } from "./mapRender";

describe("fmt", () => {
  it("trims to <=4 significant figures", () => {
    expect(fmt(61.00000001)).toBe("61");
    expect(fmt(1036.0)).toBe("1036");
  });
  it("uses exponential outside [1e-3, 1e5)", () => {
    expect(fmt(4.2e7)).toBe("4.20e+7");
    expect(fmt(0.00001)).toBe("1.00e-5");
  });
  it("renders non-finite as an em dash", () => {
    expect(fmt(NaN)).toBe("—");
  });
});

describe("minPositive", () => {
  it("finds the smallest strictly-positive finite cell", () => {
    expect(minPositive([[3, -1, 0], [null, 0.5, 9]])).toBe(0.5);
  });
  it("returns null when nothing is positive", () => {
    expect(minPositive([[0, -2], [null, NaN]])).toBeNull();
  });
});

const P: MapPayload = {
  xAxis: [0, 1, 2],
  yAxis: [0, 1, 2],
  zGrid: [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ],
  xLabel: "x",
  xUnit: "",
  yLabel: "y",
  yUnit: "",
  zLabel: "z",
  zUnit: "",
  zMin: 1,
  zMax: 9,
};

const PEAK: RsmPeak = {
  rank: 1,
  classification: "substrate",
  centre_angle: [30.5, 61.0], // [omega, 2theta]
  centre_Q: [0.5, 4.0], // [Qx, Qz]
  fwhm_angle: [0.1, 0.2],
  fwhm_Q: [0.01, 0.02],
  amplitude: 100,
  background: 1,
};

describe("peakMarkerXY", () => {
  it("maps to angular axes (2Theta x, Omega y)", () => {
    expect(peakMarkerXY(PEAK, "2Theta", "Omega")).toEqual([61.0, 30.5]);
  });
  it("maps to reciprocal axes (Qx x, Qz y)", () => {
    expect(peakMarkerXY(PEAK, "Qx", "Qz")).toEqual([0.5, 4.0]);
  });
  it("returns null when the chosen space lacks finite coords", () => {
    const noQ = { ...PEAK, centre_Q: [null, null] as [number | null, number | null] };
    expect(peakMarkerXY(noQ, "Qx", "Qz")).toBeNull();
    expect(peakMarkerXY(PEAK, "weird", "Omega")).toBeNull();
  });
});

describe("hitTest", () => {
  // For 600×400: plot rect = {x:58, y:14, w:464, h:344}.
  it("maps the plot-area centre to the centre cell", () => {
    const r = hitTest(P, 600, 400, 58 + 232, 14 + 172);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(1, 6);
    expect(r!.y).toBeCloseTo(1, 6);
    expect(r!.z).toBe(5);
  });
  it("flips y: the top-left corner is (xmin, ymax) -> grid row ny-1", () => {
    const r = hitTest(P, 600, 400, 58, 14);
    expect(r!.x).toBeCloseTo(0, 6);
    expect(r!.y).toBeCloseTo(2, 6);
    expect(r!.z).toBe(7); // zGrid[2][0]
  });
  it("returns null outside the plot area", () => {
    expect(hitTest(P, 600, 400, 10, 10)).toBeNull();
  });
});

// ── Pure heatmap RGBA generation (the map's core "visible effect") ──────────────
describe("buildHeatmapImage", () => {
  // 2×2 grid, gray colormap over [0, 10] so texel colours are trivial to predict:
  // gray(t) = round(255·t) in every channel. zGrid is row-major [ny][nx] (y up).
  const G: MapPayload = {
    xAxis: [0, 1],
    yAxis: [0, 1],
    zGrid: [
      [0, 5], // y = 0 (bottom): t = 0.0, 0.5
      [10, null], // y = 1 (top):    t = 1.0, gap
    ],
    xLabel: "x", xUnit: "", yLabel: "y", yUnit: "", zLabel: "z", zUnit: "",
    zMin: 0, zMax: 10,
  };

  it("colours each cell by the colormap and flips rows so texel row 0 is max-y", () => {
    const { data, width, height } = buildHeatmapImage(G, 0, 10, false, "gray");
    expect([width, height]).toEqual([2, 2]);
    expect(data).toHaveLength(2 * 2 * 4);
    const texel = (idx: number): number[] => Array.from(data.slice(idx * 4, idx * 4 + 4));
    // texel row 0 = top = max y (y=1 row): [v=10 → white, v=null → transparent]
    expect(texel(0)).toEqual([255, 255, 255, 255]); // v = 10
    expect(texel(1)[3]).toBe(0); // null cell → transparent gap
    // texel row 1 = bottom = min y (y=0 row): [v=0 → black, v=5 → mid-gray]
    expect(texel(2)).toEqual([0, 0, 0, 255]); // v = 0
    expect(texel(3)).toEqual([128, 128, 128, 255]); // v = 5 → round(255·0.5)
  });

  it("uses the viridis endpoints at t=0 and t=1", () => {
    const two: MapPayload = { ...G, zGrid: [[0, 10]], yAxis: [0] };
    const { data } = buildHeatmapImage(two, 0, 10, false, "viridis");
    expect(Array.from(data.slice(0, 3))).toEqual([68, 1, 84]); // t=0 dark purple
    expect(Array.from(data.slice(4, 7))).toEqual([253, 231, 37]); // t=1 yellow
  });

  it("floors log mode: non-positive / non-finite cells become transparent", () => {
    const g: MapPayload = { ...G, zGrid: [[0, -3], [1, 100]], zMin: 1, zMax: 100 };
    const { data } = buildHeatmapImage(g, 1, 100, true, "gray");
    // bottom row (texel row 1): v=0 and v=-3 → both transparent in log mode
    expect(data[2 * 4 + 3]).toBe(0);
    expect(data[3 * 4 + 3]).toBe(0);
    // top row (texel row 0): v=1 (t=0 → black opaque), v=100 (t=1 → white opaque)
    expect(data[0 * 4 + 3]).toBe(255);
    expect(data[1 * 4 + 3]).toBe(255);
  });
});

// ── Real-raster verification: run the full draw() pipeline against an actual
// canvas raster and read back pixels. Requires a canvas backend (node-canvas in
// jsdom / a browser); skips cleanly where none is available so CI stays green
// even without the optional native dep. Closes the "jsdom can't render" gap.
const CANVAS_OK = ((): boolean => {
  try {
    return document.createElement("canvas").getContext("2d") != null;
  } catch {
    return false;
  }
})();

const gradientPayload = (nx: number, ny: number, allNull = false): MapPayload => ({
  xAxis: Array.from({ length: nx }, (_, i) => i),
  yAxis: Array.from({ length: ny }, (_, j) => j),
  zGrid: Array.from({ length: ny }, (_, j) =>
    Array.from({ length: nx }, (_, i) => (allNull ? null : j * nx + i)),
  ),
  xLabel: "2Theta", xUnit: "deg", yLabel: "Omega", yUnit: "deg", zLabel: "I", zUnit: "cts",
  zMin: 0, zMax: nx * ny - 1,
});

/** Opaque, non-black pixels in an RGBA buffer (i.e. actually painted heatmap). */
function countPainted(img: Uint8ClampedArray): number {
  let n = 0;
  for (let k = 0; k < img.length; k += 4) {
    if (img[k + 3] === 255 && img[k] + img[k + 1] + img[k + 2] > 0) n++;
  }
  return n;
}

(CANVAS_OK ? describe : describe.skip)("draw (real raster)", () => {
  // 600×400 fallback (host clientWidth is 0 in jsdom) → plot rect {58,14,464,344}.
  const readInterior = (canvas: HTMLCanvasElement): Uint8ClampedArray => {
    const ctx = canvas.getContext("2d")!;
    // strictly inside the plot rect, away from axes/border/colorbar
    return ctx.getImageData(68, 24, 444, 324).data;
  };

  it("paints the heatmap interior from grid data (a filled grid vs an all-null grid)", () => {
    const host = document.createElement("div");
    const filled = document.createElement("canvas");
    draw(filled, host, gradientPayload(12, 10), "viridis", false);
    const empty = document.createElement("canvas");
    draw(empty, host, gradientPayload(12, 10, /* allNull */ true), "viridis", false);

    const filledPainted = countPainted(readInterior(filled));
    const emptyPainted = countPainted(readInterior(empty));
    // data-filled grid heavily paints the interior; the all-null grid (same
    // z-range → heatmap branch still runs) paints ~nothing (null → transparent).
    expect(filledPainted).toBeGreaterThan(1000);
    expect(emptyPainted).toBe(0);
  });

  it("renders nothing but leaves the canvas clear for a null payload", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    draw(canvas, host, null, "viridis", false);
    expect(canvas.width).toBeGreaterThan(0); // sized (600×dpr)
    expect(countPainted(readInterior(canvas))).toBe(0);
  });
});
