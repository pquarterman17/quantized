import { describe, expect, it, vi } from "vitest";

import type { ReflLayer } from "../../../lib/api/reflectivity";
import {
  expandGraded,
  formatKnots,
  formatPositions,
  gradedFitBlock,
  gradedProblem,
  gradedSpecs,
  gradedSlices,
  parseKnots,
  parsePositions,
} from "./reflGraded";
import type { ModelLayer } from "./useReflectivity";

const ROWS: ReflLayer[] = [
  [0, 0, 0, 0],
  [100, 4e-6, 0, 5],
  [0, 2.07e-6, 0, 3],
];

function stack(film: Partial<ModelLayer>): ModelLayer[] {
  return [
    { preset: "", thickness: 0, roughness: 0, sld: 0 },
    { preset: "", thickness: 100, roughness: 5, sld: 4e-6, ...film },
    { preset: "", thickness: 0, roughness: 3, sld: 2.07e-6 },
  ];
}

describe("gradedSlices", () => {
  it("cuts about 2 Å slabs, between 4 and 200 of them", () => {
    expect(gradedSlices(100)).toBe(50);
    expect(gradedSlices(3)).toBe(4);
    expect(gradedSlices(5000)).toBe(200);
  });
});

describe("parseKnots / formatKnots", () => {
  it("reads comma- or space-separated values in 10⁻⁶ Å⁻²", () => {
    expect(parseKnots("2, 3.5 4")).toEqual([2e-6, 3.5e-6, 4e-6]);
  });

  it("refuses fewer than two numbers or a non-number", () => {
    expect(parseKnots("2")).toBeNull();
    expect(parseKnots("2, x")).toBeNull();
    expect(parseKnots("")).toBeNull();
  });

  it("round-trips through the display form", () => {
    expect(parseKnots(formatKnots([2e-6, 3.5e-6]))).toEqual([2e-6, 3.5e-6]);
  });
});

describe("expandGraded", () => {
  it("passes a slab-only stack through without calling the spline route", async () => {
    const fetchSpline = vi.fn();
    const out = await expandGraded(ROWS, stack({}), fetchSpline);
    expect(out).toEqual(ROWS);
    expect(fetchSpline).not.toHaveBeenCalled();
  });

  it("replaces a graded layer with its microslabs, the first carrying the interface roughness", async () => {
    const fetchSpline = vi.fn().mockResolvedValue({
      z: [0, 50, 100],
      sld: [2e-6, 4e-6, 6e-6],
      layers: [
        [0, 2e-6, 0, 0],
        [50, 3e-6, 0, 0],
        [50, 5e-6, 0, 0],
        [0, 6e-6, 0, 0],
      ],
    });
    const graded = { knots: [2e-6, 4e-6, 6e-6], method: "pchip" as const };
    const out = await expandGraded(ROWS, stack({ graded }), fetchSpline);

    expect(fetchSpline).toHaveBeenCalledWith({
      z_knots: [0, 50, 100],
      sld_knots: [2e-6, 4e-6, 6e-6],
      method: "pchip",
      z_range: [0, 100],
      n_points: 51,
    });
    expect(out).toEqual([
      [0, 0, 0, 0],
      [50, 3e-6, 0, 5],
      [50, 5e-6, 0, 0],
      [0, 2.07e-6, 0, 3],
    ]);
  });

  it("refuses a graded layer without a thickness", async () => {
    const graded = { knots: [2e-6, 4e-6], method: "linear" as const };
    const rows: ReflLayer[] = [ROWS[0], [0, 4e-6, 0, 5], ROWS[2]];
    await expect(expandGraded(rows, stack({ graded, thickness: 0 }), vi.fn())).rejects.toThrow(
      "Layer 1 is graded and needs a thickness above 0 Å.",
    );
  });
});

// A spline-route reply for a 100 Å layer cut into two 50 Å slabs.
const twoSlabs = (a: number, b: number) => ({
  z: [0, 50, 100],
  sld: [a, (a + b) / 2, b],
  layers: [
    [0, a, 0, 0],
    [50, a, 0, 0],
    [50, b, 0, 0],
    [0, b, 0, 0],
  ],
});

describe("graded absorption and knot positions (Model mode)", () => {
  it("places the knots at their fractional positions of the thickness", async () => {
    const fetchSpline = vi.fn().mockResolvedValue(twoSlabs(2e-6, 6e-6));
    const graded = { knots: [2e-6, 4e-6, 6e-6], method: "pchip" as const, positions: [0, 0.25, 1] };
    await expandGraded(ROWS, stack({ graded }), fetchSpline);
    expect(fetchSpline).toHaveBeenCalledWith(expect.objectContaining({ z_knots: [0, 25, 100], z_range: [0, 100] }));
  });

  it("interpolates absorption knots onto the same slabs (positive = absorption)", async () => {
    const fetchSpline = vi.fn(async (body: { sld_knots: number[] }) =>
      body.sld_knots[0] === 2e-6 ? twoSlabs(3e-6, 5e-6) : twoSlabs(1e-8, 3e-8),
    );
    const graded = { knots: [2e-6, 6e-6], method: "linear" as const, isld: [1e-8, 3e-8] };
    const out = await expandGraded(ROWS, stack({ graded }), fetchSpline);
    expect(fetchSpline).toHaveBeenCalledTimes(2);
    expect(fetchSpline).toHaveBeenLastCalledWith(expect.objectContaining({ z_knots: [0, 100], sld_knots: [1e-8, 3e-8] }));
    expect(out).toEqual([
      [0, 0, 0, 0],
      [50, 3e-6, 1e-8, 5],
      [50, 5e-6, 3e-8, 0],
      [0, 2.07e-6, 0, 3],
    ]);
  });

  it("without absorption knots, the slabs carry none (the fit sends no L{i}.isld for a graded layer)", async () => {
    const fetchSpline = vi.fn().mockResolvedValue(twoSlabs(3e-6, 5e-6));
    const rows: ReflLayer[] = [ROWS[0], [100, 4e-6, 2e-8, 5], ROWS[2]];
    const out = await expandGraded(rows, stack({ graded: { knots: [2e-6, 6e-6], method: "linear" } }), fetchSpline);
    expect(out.slice(1, 3).map((r) => r[2])).toEqual([0, 0]);
    expect(fetchSpline).toHaveBeenCalledTimes(1);
  });

  it("refuses an invalid profile with the backend's reason before any request", async () => {
    const fetchSpline = vi.fn();
    const graded = { knots: [2e-6, 6e-6], method: "linear" as const, positions: [0.5, 0.2] };
    await expect(expandGraded(ROWS, stack({ graded }), fetchSpline)).rejects.toThrow(
      "Layer 1's knot positions must be strictly increasing.",
    );
    expect(fetchSpline).not.toHaveBeenCalled();
  });
});

describe("gradedProblem — the backend's graded refusals, one sentence each", () => {
  const g = (extra: object) => ({ knots: [1e-6, 2e-6, 3e-6], method: "pchip" as const, ...extra });

  it("accepts evenly spaced knots, full absorption and valid positions", () => {
    expect(gradedProblem(1, g({}))).toBeNull();
    expect(gradedProblem(1, g({ isld: [0, 1e-8, 0], positions: [0, 0.4, 1] }))).toBeNull();
  });

  it("refuses absorption on only some knots", () => {
    expect(gradedProblem(2, g({ isld: [1e-8, 0] }))).toBe("Layer 2 needs an absorption value for every knot or for none.");
  });

  it("refuses the wrong number of positions", () => {
    expect(gradedProblem(1, g({ positions: [0, 1] }))).toBe("Layer 1 needs one knot position per knot (3).");
  });

  it("refuses positions outside 0..1", () => {
    expect(gradedProblem(1, g({ positions: [0, 0.5, 1.2] }))).toBe("Layer 1's knot positions must lie within 0 to 1.");
    expect(gradedProblem(1, g({ positions: [-0.1, 0.5, 1] }))).toBe("Layer 1's knot positions must lie within 0 to 1.");
  });

  it("refuses positions that do not strictly increase", () => {
    expect(gradedProblem(1, g({ positions: [0, 0.5, 0.5] }))).toBe("Layer 1's knot positions must be strictly increasing.");
  });

  it("blocks the fit with the same reason", () => {
    const layers = stack({ graded: g({ positions: [0, 0.6, 0.3] }) });
    expect(gradedFitBlock(layers)).toBe("Layer 1's knot positions must be strictly increasing.");
  });
});

describe("parsePositions / formatPositions", () => {
  it("reads fractions; blank means evenly spaced; a non-number is refused", () => {
    expect(parsePositions("0, 0.25 1")).toEqual([0, 0.25, 1]);
    expect(parsePositions("  ")).toBeUndefined();
    expect(parsePositions("0, x")).toBeNull();
    expect(formatPositions([0, 0.25, 1])).toBe("0, 0.25, 1");
    expect(formatPositions(undefined)).toBe("");
  });
});

describe("gradedSpecs — custom positions ride along", () => {
  it("sends positions only when the layer has custom ones", () => {
    const even = stack({ graded: { knots: [1e-6, 2e-6], method: "pchip" } });
    expect(gradedSpecs(even)).toEqual([{ layer: 1, method: "pchip", slices: 50 }]);
    const custom = stack({ graded: { knots: [1e-6, 2e-6], method: "pchip", positions: [0.1, 0.9] } });
    expect(gradedSpecs(custom)).toEqual([{ layer: 1, method: "pchip", slices: 50, positions: [0.1, 0.9] }]);
  });
});
