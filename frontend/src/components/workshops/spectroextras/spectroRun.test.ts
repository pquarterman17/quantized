import { describe, expect, it } from "vitest";

import { DEFAULT_SE_OPTIONS, parsePerturbation, seProblem, seRunKey, type SeInput, type SeOptions } from "./spectroRun";

const x = Array.from({ length: 20 }, (_, i) => i * 0.5);
const ch = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, label: `s${i}`, y: x.map((v) => v + i) }));
const input = (n: number, xs = x): SeInput => ({ x: xs, channels: ch(n), xLabel: "k", xUnit: "" });
const withOpts = <K extends keyof SeOptions>(k: K, v: Partial<SeOptions[K]>): SeOptions => ({ ...DEFAULT_SE_OPTIONS, [k]: { ...DEFAULT_SE_OPTIONS[k], ...v } });

describe("seProblem", () => {
  it("needs a ticked column and finite values", () => {
    expect(seProblem("fsd", null, DEFAULT_SE_OPTIONS)).toMatch(/at least one column/);
    const bad = input(1);
    bad.channels[0].y[3] = Number.NaN;
    expect(seProblem("fsd", bad, DEFAULT_SE_OPTIONS)).toMatch(/1 value is blank/);
  });

  it("refuses an uneven X and bad HWHM / K for self-deconvolution", () => {
    const uneven = [...x];
    uneven[5] += 0.2;
    expect(seProblem("fsd", input(1, uneven), DEFAULT_SE_OPTIONS)).toMatch(/evenly spaced/);
    expect(seProblem("fsd", input(1), withOpts("fsd", { hwhm: 0 }))).toMatch(/HWHM/);
    expect(seProblem("fsd", input(1), withOpts("fsd", { k: 0.5 }))).toMatch(/at least 1/);
    expect(seProblem("fsd", input(1), DEFAULT_SE_OPTIONS)).toBeNull();
  });

  it("2-D correlation needs three spectra and one value per spectrum", () => {
    expect(seProblem("corr2d", input(2), DEFAULT_SE_OPTIONS)).toMatch(/at least 3/);
    expect(seProblem("corr2d", input(3), DEFAULT_SE_OPTIONS)).toBeNull();
    expect(seProblem("corr2d", input(3), withOpts("corr", { perturbation: "1, 2" }))).toMatch(/Give 3/);
    expect(seProblem("corr2d", input(3), withOpts("corr", { perturbation: "1, x, 3" }))).toMatch(/numbers/);
    expect(seProblem("corr2d", input(3), withOpts("corr", { perturbation: "300 310 320" }))).toBeNull();
    expect(seProblem("corr2d", input(3), withOpts("corr", { xMin: 5, xMax: 2 }))).toMatch(/below/);
  });

  it("onset checks fraction, smoothing, baseline and window", () => {
    expect(seProblem("onset", input(1), withOpts("onset", { fraction: 1 }))).toMatch(/between 0 and 1/);
    expect(seProblem("onset", input(1), withOpts("onset", { smooth: 4 }))).toMatch(/odd/);
    expect(seProblem("onset", input(1), withOpts("onset", { smooth: 7 }))).toBeNull();
    expect(seProblem("onset", input(1), withOpts("onset", { baseMin: 1 }))).toMatch(/both ends/);
    expect(seProblem("onset", input(1), withOpts("onset", { baseMin: 3, baseMax: 1 }))).toMatch(/below/);
    expect(seProblem("onset", input(1), withOpts("onset", { xMin: 3, xMax: 1 }))).toMatch(/below/);
  });
});

describe("helpers", () => {
  it("parses perturbation lists", () => {
    expect(parsePerturbation("")).toBeNull();
    expect(parsePerturbation("1, 2;3 4")).toEqual([1, 2, 3, 4]);
    expect(parsePerturbation("1, a")).toBe("bad");
  });

  it("the run key follows the tool's own settings only", () => {
    const a = seRunKey("fsd", "fp", [0], DEFAULT_SE_OPTIONS);
    expect(seRunKey("fsd", "fp", [0], withOpts("onset", { fraction: 0.5 }))).toBe(a);
    expect(seRunKey("fsd", "fp", [0], withOpts("fsd", { k: 2 }))).not.toBe(a);
    expect(seRunKey("fsd", "fp", [0, 1], DEFAULT_SE_OPTIONS)).not.toBe(a);
    expect(seRunKey("fsd", "other", [0], DEFAULT_SE_OPTIONS)).not.toBe(a);
  });
});
