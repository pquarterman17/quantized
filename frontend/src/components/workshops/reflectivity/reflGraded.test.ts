import { describe, expect, it, vi } from "vitest";

import type { ReflLayer } from "../../../lib/api/reflectivity";
import { expandGraded, formatKnots, gradedSlices, parseKnots } from "./reflGraded";
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
