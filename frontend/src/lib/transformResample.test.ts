// P2.5 align/interpolate — the recorded `resample` params: what they ask the
// backend for (preview vs commit), and how a saved (user-editable) step is
// validated before replay.

import { describe, expect, it } from "vitest";

import { gridText, resampleParamsOf, resampleRequest, type ResampleParams } from "./transformResample";
import { transformParamsOf, transformStepText } from "./transformRun";
import type { DataStruct } from "./types";

const src: DataStruct = { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["M"], units: ["emu"], metadata: { x_column_unit: "K" } };
const other: DataStruct = { time: [0.5, Number.NaN, 1.5], values: [[0], [0], [0]], labels: ["G"], units: [""], metadata: { x_column_unit: "Oe" } };
const base = { op: "resample" as const, method: "linear" as const, outOfRange: "nan" as const, sortUnsorted: false, allowUnitMismatch: false };
const match: ResampleParams = { ...base, mode: "match", with: { id: "g", name: "grid.dat" } };

describe("resampleRequest", () => {
  it("sends the other dataset's x (blank x as null) and unit; only the preview allows a unit mismatch by itself", () => {
    const commit = resampleRequest(match, src, other);
    expect(commit).toMatchObject({ mode: "match", match_x: [0.5, null, 1.5], match_x_unit: "Oe", allow_unit_mismatch: false, unsorted: "refuse" });
    expect(resampleRequest(match, src, other, true).allow_unit_mismatch).toBe(true);
    expect(resampleRequest({ ...match, allowUnitMismatch: true }, src, other).allow_unit_mismatch).toBe(true);
  });

  it("sends only the fields of the chosen grid", () => {
    const r = resampleRequest({ ...base, mode: "range", start: 0, stop: 2, step: 0.5, sortUnsorted: true }, src, null);
    expect(r).toMatchObject({ mode: "range", start: 0, stop: 2, step: 0.5, unsorted: "sort" });
    expect(r).not.toHaveProperty("n_points");
    expect(r).not.toHaveProperty("match_x");
    expect(() => resampleRequest(match, src, null)).toThrow("pick the dataset whose x to match");
  });
});

describe("recorded resample params", () => {
  it("round-trip through a JSON save and transformParamsOf unchanged", () => {
    const cases: ResampleParams[] = [
      { ...base, mode: "n_points", nPoints: 200 },
      { ...base, mode: "step", step: 0.25, method: "pchip" },
      { ...base, mode: "range", start: 10, stop: 0, step: -2, outOfRange: "clip" },
      { ...match, allowUnitMismatch: true, sortUnsorted: true, method: "makima" },
    ];
    for (const p of cases) expect(transformParamsOf(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("refuse a damaged step by name instead of guessing", () => {
    expect(() => resampleParamsOf({ mode: "wavelet" })).toThrow('unknown resample grid "wavelet"');
    expect(() => resampleParamsOf({ mode: "n_points", nPoints: 1 })).toThrow("integer ≥ 2");
    expect(() => resampleParamsOf({ mode: "range", start: 0, stop: 1 })).toThrow('needs a number "step"');
    expect(() => resampleParamsOf({ mode: "match" })).toThrow("no recorded dataset to match");
    expect(() => resampleParamsOf({ mode: "step", step: 1, method: "cubic" })).toThrow('unknown resample method "cubic"');
    expect(() => resampleParamsOf({ mode: "step", step: 1, outOfRange: "extrapolate" })).toThrow("out-of-range rule");
  });

  it("an old or hand-edited step without the flags is the safe default: refuse unsorted x and unit mismatches", () => {
    expect(resampleParamsOf({ mode: "step", step: 1 })).toEqual({ ...base, mode: "step", step: 1 });
  });

  it("label the pipeline step with the grid", () => {
    expect(gridText(match)).toBe("grid.dat's x");
    const { label, code } = transformStepText({ ...base, mode: "range", start: 0, stop: 5, step: 1 }, "a.dat");
    expect(label).toBe("Resample a.dat onto 0:1:5 (linear)");
    expect(code).toContain('qz.transform("resample"');
    expect(transformStepText(match, "a.dat").code).toContain('with: "grid.dat"');
  });
});
