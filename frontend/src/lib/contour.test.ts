import { describe, expect, it } from "vitest";

import { computeContours, contourLevels, ringToCanvas } from "./contour";

// ── contourLevels — mirrors calc/figure_map.py::_contour_levels ────────────
// Expected numbers cross-checked directly against the Python reference:
//   uv run python -c "from quantized.calc.figure_map import _contour_levels; ..."
describe("contourLevels", () => {
  it("linear count spacing includes both endpoints", () => {
    expect(contourLevels(0, 10, 5, "linear")).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it("linear count on an asymmetric range (python cross-check)", () => {
    const lv = contourLevels(-3.5, 7.25, 4, "linear");
    expect(lv[0]).toBeCloseTo(-3.5, 10);
    expect(lv[1]).toBeCloseTo(0.08333333333333348, 10);
    expect(lv[2]).toBeCloseTo(3.666666666666667, 10);
    expect(lv[3]).toBeCloseTo(7.25, 10);
  });

  it("log count spacing with a positive z-min", () => {
    const lv = contourLevels(1, 100, 3, "log");
    expect(lv[0]).toBeCloseTo(1, 10);
    expect(lv[1]).toBeCloseTo(10, 10);
    expect(lv[2]).toBeCloseTo(100, 10);
  });

  it("log floor: a non-positive z-min floors at z-max * 1e-3", () => {
    const lv = contourLevels(-5, 100, 3, "log");
    expect(lv[0]).toBeCloseTo(0.1, 10);
    expect(lv[1]).toBeCloseTo(3.1622776601683795, 10);
    expect(lv[2]).toBeCloseTo(100, 10);
  });

  it("explicit level list is sorted, duplicated entries kept", () => {
    expect(contourLevels(0, 10, [5, 1, 9], "linear")).toEqual([1, 5, 9]);
  });

  it("throws when an explicit list has fewer than 2 entries", () => {
    expect(() => contourLevels(0, 10, [5], "linear")).toThrow(/at least 2 entries/);
  });

  it("throws when the level count is < 2", () => {
    expect(() => contourLevels(0, 10, 1, "linear")).toThrow(/must be >= 2/);
  });

  it("throws on a non-finite or inverted z-range", () => {
    expect(() => contourLevels(5, 5, 4, "linear")).toThrow(/no finite z-range/);
    expect(() => contourLevels(NaN, 10, 4, "linear")).toThrow(/no finite z-range/);
  });

  it("throws for log scale over a non-positive z-max", () => {
    expect(() => contourLevels(-10, -1, 3, "log")).toThrow(/positive z-range/);
  });

  it("throws for an unrecognized scale", () => {
    expect(() => contourLevels(0, 10, 4, "weird" as unknown as "linear")).toThrow(
      /'linear' or 'log'/,
    );
  });
});

// ── computeContours — d3-contour wrapper -> data-coordinate rings ──────────
describe("computeContours", () => {
  it("converts a known 3x3 grid contour to data coordinates (d3-contour cross-check)", () => {
    // values[i + j*3]: every row is [0, 1, 2] along x -> a vertical step at x=1.
    const xAxis = [0, 1, 2];
    const yAxis = [0, 1, 2];
    const zGrid = [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ];
    const [line] = computeContours(xAxis, yAxis, zGrid, [1]);
    expect(line.level).toBe(1);
    expect(line.rings).toHaveLength(1);
    const ring = line.rings[0];
    // Closed ring (d3-contour always closes).
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // Threshold 1 exactly equals the value at sample x=1 (col 1), so the near
    // edge sits precisely at data x=1.0 (linear interpolation between col 0's
    // value 0 and col 1's value 1 lands exactly on the col-1 sample). The far
    // edge is clamped to the grid boundary (x = 2.5, half a cell beyond the
    // last sample -- d3-contour's cell-centred convention, see contour.ts's
    // docstring).
    const xs = ring.map(([x]) => x);
    expect(Math.min(...xs)).toBeCloseTo(1.0, 10);
    expect(Math.max(...xs)).toBeCloseTo(2.5, 10);
  });

  it("returns no lines for an out-of-range level", () => {
    const xAxis = [0, 1, 2];
    const yAxis = [0, 1, 2];
    const zGrid = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const [line] = computeContours(xAxis, yAxis, zGrid, [500]);
    expect(line.rings).toEqual([]);
  });

  it("treats null (gap) cells as below every threshold without throwing", () => {
    const xAxis = [0, 1, 2, 3];
    const yAxis = [0, 1, 2, 3];
    const zGrid = [
      [1, 1, 1, 1],
      [1, null, null, 1],
      [1, null, null, 1],
      [1, 1, 1, 1],
    ];
    expect(() => computeContours(xAxis, yAxis, zGrid, [0.5])).not.toThrow();
    const [line] = computeContours(xAxis, yAxis, zGrid, [0.5]);
    for (const ring of line.rings) {
      for (const [x, y] of ring) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  });

  it("degenerate grid (< 2x2 or no levels) returns no lines instead of throwing", () => {
    expect(computeContours([0], [0, 1], [[1], [2]], [0.5])).toEqual([]);
    expect(computeContours([0, 1], [0, 1], [[1, 2], [3, 4]], [])).toEqual([]);
  });

  // Synthetic Gaussian bump: a single ring should encircle the peak at a
  // radius matching the analytic half-max contour (r = sigma * sqrt(2 ln 2)
  // at level = 0.5 for a unit-amplitude Gaussian), centred near the origin.
  // Expected numbers cross-checked with a standalone d3-contour run.
  it("recovers the half-max ring of a synthetic Gaussian bump", () => {
    const n = 21;
    const sigma = 1.5;
    const axis = Array.from({ length: n }, (_, i) => -5 + (10 * i) / (n - 1));
    const zGrid: number[][] = Array.from({ length: n }, (_, j) =>
      Array.from({ length: n }, (_, i) => {
        const x = axis[i];
        const y = axis[j];
        return Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
      }),
    );
    const [line] = computeContours(axis, axis, zGrid, [0.5]);
    expect(line.rings).toHaveLength(1);
    const ring = line.rings[0];
    const radii = ring.map(([x, y]) => Math.hypot(x, y));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    const analytic = sigma * Math.sqrt(2 * Math.log(2));
    expect(mean).toBeCloseTo(analytic, 1); // within ~0.05 (grid resolution)
    for (const r of radii) expect(r).toBeGreaterThan(analytic - 0.1);
    for (const r of radii) expect(r).toBeLessThan(analytic + 0.1);
    const cx = ring.reduce((a, [x]) => a + x, 0) / ring.length;
    const cy = ring.reduce((a, [, y]) => a + y, 0) / ring.length;
    expect(cx).toBeCloseTo(0, 0);
    expect(cy).toBeCloseTo(0, 0);
  });
});

// ── ringToCanvas — same rect/axis-extent transform as mapRender.ts ─────────
describe("ringToCanvas", () => {
  it("maps a data-space ring into the plot rect (matches mapRender.ts's hitTest inverse)", () => {
    const rect = { x: 58, y: 14, w: 464, h: 344 };
    const xAxis = [0, 2];
    const yAxis = [0, 2];
    const ring: [number, number][] = [
      [0, 0], // (xmin, ymin) -> bottom-left of the plot rect
      [2, 2], // (xmax, ymax) -> top-right of the plot rect
      [1, 1], // centre
    ];
    const px = ringToCanvas(ring, xAxis, yAxis, rect);
    expect(px[0][0]).toBeCloseTo(58, 6);
    expect(px[0][1]).toBeCloseTo(14 + 344, 6); // ymin -> bottom (screen y is top-down)
    expect(px[1][0]).toBeCloseTo(58 + 464, 6);
    expect(px[1][1]).toBeCloseTo(14, 6); // ymax -> top
    expect(px[2][0]).toBeCloseTo(58 + 232, 6);
    expect(px[2][1]).toBeCloseTo(14 + 172, 6);
  });

  it("degenerate (zero-span) axis does not divide by zero", () => {
    const rect = { x: 0, y: 0, w: 100, h: 100 };
    const px = ringToCanvas([[5, 5]], [5, 5], [5, 5], rect);
    expect(Number.isFinite(px[0][0])).toBe(true);
    expect(Number.isFinite(px[0][1])).toBe(true);
  });
});
