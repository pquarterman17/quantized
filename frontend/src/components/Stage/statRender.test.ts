import { describe, expect, it } from "vitest";

import type { BoxStat } from "../../lib/statstage";
import { seriesStat, type BarChartData } from "../../lib/barlayout";
import { draw, fmt, type StatDrawData, type ViolinGroup } from "./statRender";

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

// ── Real-raster verification: run the full draw() pipeline against an actual
// canvas raster and read back pixels. Requires a canvas backend (node-canvas in
// jsdom / a browser); skips cleanly where none is available so CI stays green
// even without the optional native dep (mapRender.test.ts's pattern — this is
// the "jsdom can't render" gap the pure-lib split (lib/statstage.ts) covers).
const CANVAS_OK = ((): boolean => {
  try {
    return document.createElement("canvas").getContext("2d") != null;
  } catch {
    return false;
  }
})();

/** Opaque, non-black pixels in an RGBA buffer (i.e. actually painted something). */
function countPainted(img: Uint8ClampedArray): number {
  let n = 0;
  for (let k = 0; k < img.length; k += 4) {
    if (img[k + 3] > 0 && img[k] + img[k + 1] + img[k + 2] > 0) n++;
  }
  return n;
}

const BOX_A: BoxStat = {
  label: "A",
  q1: 3.5,
  median: 6,
  q3: 8.5,
  iqr: 5,
  whislo: 1,
  whishi: 10,
  mean: 6.2,
  n: 11,
  fliers: [50],
};
const BOX_B: BoxStat = { ...BOX_A, label: "B", q1: 2, median: 4, q3: 6, whislo: 0, whishi: 9, fliers: [] };

const VIOLIN_A: ViolinGroup = {
  label: "A",
  x: Array.from({ length: 32 }, (_, i) => i / 4),
  density: Array.from({ length: 32 }, (_, i) => Math.exp(-((i - 16) ** 2) / 40)),
  quartiles: [6, 8, 10],
  n: 40,
};

(CANVAS_OK ? describe : describe.skip)("draw (real raster)", () => {
  // 600x400 host fallback (clientWidth is 0 in jsdom).
  const readAll = (canvas: HTMLCanvasElement): Uint8ClampedArray =>
    canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;

  function paints(data: StatDrawData): boolean {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    draw(canvas, host, data);
    return countPainted(readAll(canvas)) > 0;
  }

  it("box mode paints boxes/whiskers/fliers", () => {
    expect(paints({ mode: "box", boxes: [BOX_A, BOX_B], valueLabel: "value", groupLabel: "group" })).toBe(
      true,
    );
  });

  it("violin mode paints a filled outline", () => {
    expect(
      paints({ mode: "violin", violins: [VIOLIN_A], valueLabel: "value", groupLabel: "group" }),
    ).toBe(true);
  });

  it("qq mode paints a scatter + reference line", () => {
    const theo = [-2, -1, 0, 1, 2];
    const obs = [-1.8, -0.9, 0.1, 1.2, 2.1];
    expect(
      paints({ mode: "qq", theo, obs, slope: 1, intercept: 0, dist: "norm", valueLabel: "value" }),
    ).toBe(true);
  });

  it("histogram mode paints bars, and a fit overlay when present", () => {
    const edges = [0, 1, 2, 3, 4];
    const counts = [2, 5, 3, 1];
    expect(
      paints({ mode: "histogram", edges, counts, density: false, valueLabel: "value" }),
    ).toBe(true);
    expect(
      paints({
        mode: "histogram",
        edges,
        counts,
        density: true,
        valueLabel: "value",
        fit: { dist: "norm", x: [0, 1, 2, 3, 4], pdf: [0.05, 0.2, 0.3, 0.15, 0.02] },
      }),
    ).toBe(true);
  });

  it("bar mode (grouped) paints clustered bars with error whiskers", () => {
    const data: BarChartData = {
      groups: [
        { label: "Low", series: [seriesStat([1, 2, 3]), seriesStat([4, 5, 6])] },
        { label: "High", series: [seriesStat([10, 12]), seriesStat([-3, -1])] },
      ],
      seriesLabels: ["A", "B"],
    };
    expect(
      paints({ mode: "bar", data, valueLabel: "value", groupLabel: "group", stacked: false }),
    ).toBe(true);
  });

  it("bar mode (stacked) paints cumulative segments", () => {
    const data: BarChartData = {
      groups: [{ label: "Low", series: [seriesStat([1, 2, 3]), seriesStat([4, 5, 6])] }],
      seriesLabels: ["A", "B"],
    };
    expect(
      paints({ mode: "bar", data, valueLabel: "value", groupLabel: "group", stacked: true }),
    ).toBe(true);
  });

  it("bar mode does not throw on an empty-groups payload (defensive guard)", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    const empty: BarChartData = { groups: [], seriesLabels: [] };
    expect(() =>
      draw(canvas, host, { mode: "bar", data: empty, valueLabel: "v", groupLabel: "g", stacked: false }),
    ).not.toThrow();
  });

  it("renders nothing but leaves the canvas clear for a null payload", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    draw(canvas, host, null);
    expect(canvas.width).toBeGreaterThan(0); // sized (600×dpr)
    expect(countPainted(readAll(canvas))).toBe(0);
  });

  it("does not throw on an empty-boxes payload (defensive guard)", () => {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    expect(() => draw(canvas, host, { mode: "box", boxes: [], valueLabel: "v", groupLabel: "g" })).not.toThrow();
  });
});
