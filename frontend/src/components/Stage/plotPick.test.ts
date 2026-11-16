// UX-A: what a Pointer click selects, and the halo drawn for it.

import { afterEach, describe, expect, it } from "vitest";

import { haloGeometry, haloKey, pickAt, visibleRuns } from "./plotPick";
import { makeFakePlot, OVER } from "../../test/plotSelectionFixture";

afterEach(() => {
  document.body.innerHTML = "";
});

// Client point of data (x, y) at the default 0..10 window.
const at = (x: number, y: number): [number, number] => [OVER.left + x * 10, OVER.top + (10 - y) * 10];

/** Every vertex of an SVG path as [x, y]. */
const vertices = (d: string) => [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe("pickAt", () => {
  it("selects the curve under the click, by dataset channel", () => {
    const { u, over } = makeFakePlot();
    // plotted: display series 0 -> channel 3, display series 1 -> channel 5.
    expect(pickAt(u, over, ...at(2, 2), [3, 5], false)).toEqual({ kind: "series", channel: 3 });
    expect(pickAt(u, over, ...at(2, 8), [3, 5], false)).toEqual({ kind: "series", channel: 5 });
  });

  it("clears on empty plot area, far from every curve", () => {
    const { u, over } = makeFakePlot();
    expect(pickAt(u, over, ...at(1, 5), [0, 1], false)).toBeNull();
  });

  it("leaves a press an object plugin claimed (annotation / shape / reference line) to it", () => {
    const { u, over } = makeFakePlot();
    expect(pickAt(u, over, ...at(2, 2), [0, 1], false, true)).toBeUndefined();
  });

  it("does not pick a hidden curve", () => {
    const { u, over } = makeFakePlot();
    (u.series[1] as { show: boolean }).show = false;
    expect(pickAt(u, over, ...at(2, 2), [0, 1], false)).toBeNull();
  });

  it("picks either branch of a hysteresis loop (2-D distance, not the first nearest x)", () => {
    // A closed loop: up the lower branch at y = 2, back along the upper one at y = 8.
    const xs = [0, 2, 4, 6, 8, 10, 8, 6, 4, 2, 0];
    const ys = [2, 2, 2, 2, 2, 2, 8, 8, 8, 8, 8];
    const { u, over } = makeFakePlot({ data: [xs, ys, ys.map(() => NaN)] });
    expect(pickAt(u, over, ...at(4, 8), [0, 1], false)).toEqual({ kind: "series", channel: 0 });
    expect(pickAt(u, over, ...at(4, 2), [0, 1], false)).toEqual({ kind: "series", channel: 0 });
    expect(pickAt(u, over, ...at(4, 5), [0, 1], false)).toBeNull();
  });

  it("picks between two points, on the drawn segment", () => {
    const { u, over } = makeFakePlot({ data: [[0, 10], [0, 10], [10, 10]] });
    // Mid-way along the diagonal (5, 5), where no data point is.
    expect(pickAt(u, over, ...at(5, 5), [0, 1], false)).toEqual({ kind: "series", channel: 0 });
  });

  it("is turn-aware: on a horizontal-bar plot x runs up the plot", () => {
    const { u, over } = makeFakePlot({ turned: true });
    // Series 0 (y = x) at x = 2: y = 2 across (20 px), x = 2 up (80 px down).
    expect(pickAt(u, over, OVER.left + 20, OVER.top + 80, [0, 1], false)).toEqual({ kind: "series", channel: 0 });
    // The upright reading of that point (x across) is empty on the turned plot.
    expect(pickAt(u, over, ...at(2, 5), [0, 1], false)).toBeNull();
  });

  it("selects the axis whose band holds the click", () => {
    const { u, axisX } = makeFakePlot();
    expect(pickAt(u, axisX, 100, 140, [0, 1], false)).toEqual({ kind: "axis", axis: "x" });
    expect(pickAt(u, axisX, 20, 60, [0, 1], false)).toEqual({ kind: "axis", axis: "y" });
    expect(pickAt(u, axisX, 180, 60, [0, 1], true)).toEqual({ kind: "axis", axis: "y2" });
    // No Y2 drawn: the right gutter selects nothing.
    expect(pickAt(u, axisX, 180, 60, [0, 1], false)).toBeUndefined();
  });

  it("an extra Y3+ axis band selects nothing, not Y or Y2", () => {
    const { u, root } = makeFakePlot();
    const axis = (left: number, width: number) => {
      const el = root.appendChild(document.createElement("div"));
      el.className = "u-axis";
      el.getBoundingClientRect = () => ({ left, right: left + width, top: 20, bottom: 120, width, height: 100 }) as DOMRect;
      return el;
    };
    const y = axis(25, 25); // next to the plot area
    axis(0, 25); // Y3, further out on the left
    const y2 = axis(150, 25);
    axis(175, 25); // Y4 on the right
    expect(pickAt(u, y, 35, 60, [0, 1], true)).toEqual({ kind: "axis", axis: "y" });
    expect(pickAt(u, y, 10, 60, [0, 1], true)).toBeUndefined();
    expect(pickAt(u, y2, 160, 60, [0, 1], true)).toEqual({ kind: "axis", axis: "y2" });
    expect(pickAt(u, y2, 190, 60, [0, 1], true)).toBeUndefined();
  });

  it("a legend row selects its curve; the box selects the legend; the swatch toggle is left alone", () => {
    const { u, legend } = makeFakePlot();
    const row = legend.appendChild(document.createElement("div"));
    row.className = "it";
    row.dataset.channel = "4";
    const swatch = row.appendChild(document.createElement("span"));
    swatch.className = "qzk-legend-toggle";
    const label = row.appendChild(document.createElement("span"));
    expect(pickAt(u, label, 130, 35, [4, 5], false)).toEqual({ kind: "series", channel: 4 });
    expect(pickAt(u, legend, 121, 31, [4, 5], false)).toEqual({ kind: "legend" });
    expect(pickAt(u, swatch, 125, 35, [4, 5], false)).toBeUndefined();
  });

  it("ignores a click elsewhere in the stage (toolbar, title)", () => {
    const { u, stage } = makeFakePlot();
    expect(pickAt(u, stage, 5, 5, [0, 1], false)).toBeUndefined();
  });
});

describe("haloGeometry", () => {
  it("strokes the selected curve's points in stage coordinates, wider than the line", () => {
    const { u, stage } = makeFakePlot();
    const g = haloGeometry(u, stage, { kind: "series", channel: 7 }, [4, 7]);
    // Display series 1 (channel 7) falls: (0,10) -> (50,20) ... (10,0) -> (150,120).
    expect(g.d.startsWith("M50.0,20.0L60.0,30.0")).toBe(true);
    expect(g.d.endsWith("L150.0,120.0")).toBe(true);
    expect(g.width).toBe(7.5);
    expect(g.box).toBeNull();
  });

  it("is clipped to the plot area, and drops points off the zoomed window", () => {
    const { u, stage } = makeFakePlot();
    u.scales.x.min = 4;
    u.scales.x.max = 6;
    const g = haloGeometry(u, stage, { kind: "series", channel: 0 }, [0, 1]);
    expect(g.clip).toEqual({ x: 50, y: 20, w: 100, h: 100 });
    // x = 4..6 is the window; 3 and 7 stay so the line reaches the edge.
    expect(vertices(g.d).map(([x]) => x)).toEqual([0, 50, 100, 150, 200]);
    // Every vertex is inside the plot area or one data step past its edge.
    for (const [x] of vertices(g.d)) expect(x).toBeGreaterThanOrEqual(0);
    expect(vertices(g.d).filter(([x]) => x < 50 || x > 150)).toHaveLength(2);
  });

  it("keeps a one-sample peak when many points share a pixel column", () => {
    const n = 20_000;
    const xs = Array.from({ length: n }, (_, i) => (i / (n - 1)) * 10);
    const ys = xs.map((_, i) => (i === 12_345 ? 9 : 1));
    const { u, stage } = makeFakePlot({ data: [xs, ys, ys] });
    const g = haloGeometry(u, stage, { kind: "series", channel: 0 }, [0, 1]);
    const ysPx = vertices(g.d).map(([, y]) => y);
    expect(ysPx.length).toBeLessThan(600); // ~4 per pixel column, not 20k
    expect(Math.min(...ysPx)).toBeCloseTo(20 + 10, 5); // y = 9 -> 10 px below the top
  });

  it("samples the visible range: zoomed in, every point there is drawn", () => {
    const n = 100_000;
    const xs = Array.from({ length: n }, (_, i) => (i / (n - 1)) * 10);
    const { u } = makeFakePlot({ data: [xs, xs, xs] });
    u.scales.x.min = 5;
    u.scales.x.max = 5.01; // ~100 rows across 100 px
    const runs = visibleRuns(u, 0);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.length).toBeGreaterThan(90);
  });

  it("is turn-aware on a horizontal-bar plot", () => {
    const { u, stage } = makeFakePlot({ turned: true });
    const g = haloGeometry(u, stage, { kind: "series", channel: 0 }, [0, 1]);
    // y = x: (0,0) -> across 0, up from the bottom: (50,120); (10,10) -> (150,20).
    expect(g.d.startsWith("M50.0,120.0")).toBe(true);
    expect(g.d.endsWith("L150.0,20.0")).toBe(true);
  });

  it("draws dots for a markers-only curve", () => {
    const { u, stage } = makeFakePlot({ widths: [0, 1.5] });
    const g = haloGeometry(u, stage, { kind: "series", channel: 0 }, [0, 1]);
    expect(g.d).toContain("M50.0,120.0h0M60.0,110.0h0");
    expect(g.d).not.toContain("L");
  });

  it("draws nothing for a curve that is not plotted", () => {
    const { u, stage } = makeFakePlot();
    const g = haloGeometry(u, stage, { kind: "series", channel: 9 }, [0, 1]);
    expect(g.d).toBe("");
    expect(g.box).toBeNull();
  });

  it("outlines the axis band and the legend box", () => {
    const { u, stage } = makeFakePlot();
    expect(haloGeometry(u, stage, { kind: "axis", axis: "x" }, [0, 1]).box).toEqual({ x: 50, y: 120, w: 100, h: 40 });
    expect(haloGeometry(u, stage, { kind: "axis", axis: "y" }, [0, 1]).box).toEqual({ x: 0, y: 20, w: 50, h: 100 });
    expect(haloGeometry(u, stage, { kind: "legend" }, [0, 1]).box).toEqual({ x: 120, y: 30, w: 25, h: 15 });
  });
});

describe("haloKey", () => {
  it("changes with the scale window, the data and the series, and only then", () => {
    const { u, stage } = makeFakePlot();
    const sel = { kind: "series", channel: 0 } as const;
    const k0 = haloKey(u, stage, sel, [0, 1]);
    expect(haloKey(u, stage, sel, [0, 1])).toBe(k0);
    u.scales.x.max = 8;
    const k1 = haloKey(u, stage, sel, [0, 1]);
    expect(k1).not.toBe(k0);
    (u as unknown as { data: number[][] }).data = [u.data[0] as number[], [1, 2], u.data[2] as number[]];
    expect(haloKey(u, stage, sel, [0, 1])).not.toBe(k1);
  });
});
