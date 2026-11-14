// Gap-audit-2 #5: the top X axis' ticks. The SAME table as
// tests/test_axis_style.py's TOP_TABLE, so screen and export pick identical
// tick values and labels.

import { describe, expect, it } from "vitest";

import type { TopAxis } from "./axisFormat";
import { niceTicks, topAxisProblem, topForward, topInverse, topTicks } from "./axisTop";

const TOP_TABLE: [TopAxis, [number, number], string[]][] = [
  [{ kind: "reciprocal", factor: 1000 }, [100, 300], ["10", "9", "8", "7", "6", "5", "4"]],
  [{ kind: "reciprocal" }, [2, 10], ["0.50", "0.45", "0.40", "0.35", "0.30", "0.25", "0.20", "0.15", "0.10"]],
  [{ kind: "dspacing", wavelength: 1.5406 }, [20, 80], ["4.0", "3.5", "3.0", "2.5", "2.0", "1.5"]],
  [{ kind: "linear", factor: 2, shift: 1 }, [0, 10], ["2.5", "5.0", "7.5", "10.0", "12.5", "15.0", "17.5", "20.0"]],
  [{ kind: "linear", factor: -1 }, [-5, 5], ["4", "2", "0", "-2", "-4"]],
];

describe("top X axis", () => {
  it.each(TOP_TABLE)("%o over %o matches the export's ticks", (top, [lo, hi], labels) => {
    const ticks = topTicks(top, lo, hi);
    expect(ticks.map((t) => t.label)).toEqual(labels);
    for (const t of ticks) {
      expect(topForward(top, t.pos)).toBeCloseTo(t.value, 9);
      expect(topInverse(top, t.value)).toBeCloseTo(t.pos, 9);
    }
  });

  it("draws nothing across a transform's singularity", () => {
    expect(topTicks({ kind: "reciprocal" }, -1, 1)).toEqual([]);
    expect(topTicks({ kind: "dspacing", wavelength: 1.54 }, -5, 30)).toEqual([]);
    expect(niceTicks(1, 1).values).toEqual([]);
  });

  it("names what a top axis is missing", () => {
    expect(topAxisProblem({ kind: "dspacing" })).toMatch(/wavelength/);
    expect(topAxisProblem({ kind: "linear", factor: 0 })).toMatch(/factor/);
    expect(topAxisProblem({ kind: "reciprocal", factor: 1000 })).toBeNull();
  });
});
