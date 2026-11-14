// Gap-audit-2 #5: the top X axis' ticks. The SAME table as
// tests/test_axis_style.py's TOP_TABLE, so screen and export pick identical
// tick values and labels.

import { describe, expect, it } from "vitest";

import { axisDraft, axisDraftErrors } from "./axisDialogModel";
import { sanitizeAxisExtras, type TopAxis } from "./axisFormat";
import { niceTicks, TOP_GAP_PER_CHAR, TOP_MIN_GAP, topAxisProblem, topForward, topInverse, topRangeProblem, topSpan, topTicks } from "./axisTop";

const TOP_TABLE: [TopAxis, [number, number], string[]][] = [
  [{ kind: "reciprocal", factor: 1000 }, [100, 300], ["10", "9", "8", "7", "6", "5", "4"]],
  [{ kind: "reciprocal" }, [2, 10], ["0.50", "0.35", "0.25", "0.20", "0.15", "0.10"]],
  [{ kind: "dspacing", wavelength: 1.5406 }, [20, 80], ["4.0", "3.0", "2.5", "2.0", "1.5"]],
  [{ kind: "linear", factor: 2, shift: 1 }, [0, 10], ["2.5", "5.0", "7.5", "10.0", "12.5", "15.0", "17.5", "20.0"]],
  [{ kind: "linear", factor: -1 }, [-5, 5], ["4", "2", "0", "-2", "-4"]],
  // N8: arbitrary expressions of the bottom axis (same rows as tests/test_axis_style.py).
  [{ kind: "expr", expr: "1240/x" }, [200, 800], ["6", "5", "4", "3", "2"]],
  [{ kind: "expr", expr: "1/x" }, [2, 10], ["0.50", "0.35", "0.25", "0.20", "0.15", "0.10"]],
  [{ kind: "expr", expr: "sqrt(x)" }, [1, 100], ["2", "4", "6", "8", "10"]],
  // a range through the pole: the end next to it is cut back to a 20x change
  [{ kind: "expr", expr: "1240/x" }, [0, 20], ["1200", "400", "200"]],
];

describe("top X axis", () => {
  it.each(TOP_TABLE)("%o over %o matches the export's ticks", (top, [lo, hi], labels) => {
    const ticks = topTicks(top, lo, hi);
    expect(ticks.map((t) => t.label)).toEqual(labels);
    for (const t of ticks) {
      expect(topForward(top, t.pos)).toBeCloseTo(t.value, 9);
      expect(topInverse(top, t.value, [lo, hi])).toBeCloseTo(t.pos, 9);
    }
  });

  it.each(TOP_TABLE)("%o over %o: the gap scales with the label width (shared rule)", (top, [lo, hi]) => {
    const ticks = topTicks(top, lo, hi);
    const gap = Math.max(TOP_MIN_GAP, TOP_GAP_PER_CHAR * (Math.max(...ticks.map((t) => t.label.length)) + 1));
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].pos - ticks[i - 1].pos).toBeGreaterThanOrEqual((hi - lo) * gap - 1e-6);
  });

  it("ticks only the valid part of a range that runs into the singularity", () => {
    const t = topTicks({ kind: "reciprocal", factor: 1000 }, 0, 10);
    expect(t.length).toBeGreaterThan(0);
    for (const k of t) {
      expect(k.pos).toBeGreaterThan(0);
      expect(k.pos).toBeLessThanOrEqual(10);
      expect(k.label).not.toMatch(/NaN|Infinity/);
    }
    expect(topTicks({ kind: "reciprocal" }, -1, 1).every((k) => k.pos > 0)).toBe(true);
    const d = topTicks({ kind: "dspacing", wavelength: 1.54 }, -5, 30);
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((k) => k.pos > 0 && k.pos <= 30)).toBe(true);
    expect(niceTicks(1, 1).values).toEqual([]);
  });

  it("draws no top axis when no part of the range is valid", () => {
    expect(topTicks({ kind: "reciprocal", factor: 1000 }, -10, -1)).toEqual([]);
    expect(topTicks({ kind: "reciprocal" }, -10, 0)).toEqual([]);
    expect(topTicks({ kind: "dspacing", wavelength: 1.54 }, -20, -1)).toEqual([]);
    expect(topSpan({ kind: "reciprocal" }, -10, -1)).toBeNull();
    expect(topSpan({ kind: "reciprocal" }, 0, 10)).toEqual([0.1, 10]);
    expect(topRangeProblem({ kind: "reciprocal" }, -10, -1)).toBe("1/T needs X > 0.");
    expect(topRangeProblem({ kind: "reciprocal" }, 0, 10)).toBeNull();
    expect(topRangeProblem({ kind: "reciprocal" }, null, null)).toBeNull();
  });

  it("the Axis dialog says why a 1/T axis over negative limits shows nothing", () => {
    const base = axisDraft({ xScale: "linear", yScale: "linear", y2Scale: null, xLim: null, yLim: null, y2Lim: null, xStep: null, yStep: null, y2Step: null, xFmt: { mode: "auto", digits: 2 }, yFmt: { mode: "auto", digits: 2 }, y2Fmt: null, axisLabelStyles: {}, xReversed: false } as never, "x");
    const d = { ...base, topKind: "reciprocal" as const, topFactor: "1000", from: "-10", to: "-1" };
    expect(axisDraftErrors(d, "x")).toContain("1/T needs X > 0.");
    expect(axisDraftErrors({ ...d, from: "0", to: "10" }, "x")).toEqual([]);
  });

  it("names what a top axis is missing", () => {
    expect(topAxisProblem({ kind: "dspacing" })).toMatch(/wavelength/);
    expect(topAxisProblem({ kind: "linear", factor: 0 })).toMatch(/factor/);
    expect(topAxisProblem({ kind: "reciprocal", factor: 1000 })).toBeNull();
  });
});

describe("expression top axis (N8)", () => {
  it("labels the valid side of a range through a pole instead of failing", () => {
    const top: TopAxis = { kind: "expr", expr: "1240/x" };
    for (const [lo, hi] of [[-5, 5], [0, 10], [-1, 300]]) {
      const ticks = topTicks(top, lo, hi);
      expect(ticks.length).toBeGreaterThan(0);
      for (const t of ticks) {
        expect(t.pos).toBeGreaterThan(0);
        expect(Number.isFinite(t.value)).toBe(true);
        expect(t.label).not.toMatch(/NaN|Infinity/);
      }
    }
    expect(topTicks(top, -10, -1).length).toBeGreaterThan(0);
    expect(topTicks({ kind: "expr", expr: "sqrt(x)" }, -9, -1)).toEqual([]);
    expect(topTicks({ kind: "expr", expr: "x^2" }, -3, 3).every((t) => t.pos >= 0)).toBe(true);
    expect(topTicks({ kind: "expr", expr: "5" }, 0, 10)).toEqual([]);
    expect(topRangeProblem({ kind: "expr", expr: "sqrt(x)" }, -9, -1)).toMatch(/monotonic/);
    expect(topRangeProblem(top, -5, 5)).toBeNull();
  });

  it("parses without eval, with the same rules as the export", () => {
    const f = (expr: string): number => topForward({ kind: "expr", expr }, 3);
    expect(f("-x^2")).toBe(9);
    expect(f("-x**2")).toBe(-9);
    expect(f("2*x")).toBe(6);
    for (const bad of ["__import__('os')", "x.real", "open(x)", "x;1", "foo(x)", "", "1+", "(x", "A+x", "x > 1", "lag(x)", "math.sqrt(x)"]) {
      expect(topAxisProblem({ kind: "expr", expr: bad }), bad).not.toBeNull();
      expect(f(bad), bad).toBeNaN();
    }
    expect(topAxisProblem({ kind: "expr", expr: "1240/x" })).toBeNull();
  });

  it("survives a save / load: the sanitiser keeps a valid expr axis and drops a blank one", () => {
    const kept = sanitizeAxisExtras({ mode: "auto", digits: 2, top: { kind: "expr", expr: " 1240/x ", title: "E" } });
    expect(kept.top).toEqual({ kind: "expr", expr: " 1240/x ".slice(0, 200), title: "E" });
    expect(sanitizeAxisExtras({ mode: "auto", digits: 2, top: { kind: "expr", expr: "  " } }).top).toEqual({ kind: "expr" });
  });

  it("the Axis dialog reports a bad expression", () => {
    const base = axisDraft({ xScale: "linear", yScale: "linear", y2Scale: null, xLim: null, yLim: null, y2Lim: null, xStep: null, yStep: null, y2Step: null, xFmt: { mode: "auto", digits: 2 }, yFmt: { mode: "auto", digits: 2 }, y2Fmt: null, axisLabelStyles: {}, xReversed: false } as never, "x");
    const d = { ...base, topKind: "expr" as const, topExpr: "foo(x)" };
    expect(axisDraftErrors(d, "x").join(" ")).toMatch(/unknown name/);
    expect(axisDraftErrors({ ...d, topExpr: "1240/x" }, "x")).toEqual([]);
  });
});

describe("top axis label spacing", () => {
  it("1/T (factor 1000) over 10-300 K has no two labels closer than the minimum gap", () => {
    const ticks = topTicks({ kind: "reciprocal", factor: 1000 }, 10, 300);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].pos - ticks[i - 1].pos).toBeGreaterThanOrEqual(290 * TOP_MIN_GAP - 1e-6);
  });
});
