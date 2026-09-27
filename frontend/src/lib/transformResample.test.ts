// P2.5 align/interpolate — the recorded `resample` params: what they ask the
// backend for (preview vs commit), and how a saved (user-editable) step is
// validated before replay.

import { describe, expect, it, vi } from "vitest";

import {
  computeResample,
  gridText,
  resampleParamsOf,
  resampleRequest,
  xUnitConflict,
  xUnitOf,
  type ResampleParams,
} from "./transformResample";
import { transformParamsOf, transformStepText } from "./transformRun";
import type { DataStruct, Dataset } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";

vi.mock("./api/resample", () => ({ resampleDataset: vi.fn() }));
const { resampleDataset } = await import("./api/resample");

const src: DataStruct = { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["M"], units: ["emu"], metadata: { x_column_unit: "K" } };
const other: DataStruct = { time: [0.5, Number.NaN, 1.5], values: [[0], [0], [0]], labels: ["G"], units: [""], metadata: { x_column_unit: "Oe" } };
const base = { op: "resample" as const, method: "linear" as const, outOfRange: "nan" as const, sortUnsorted: false };
const match: ResampleParams = { ...base, mode: "match", with: { id: "g", name: "grid.dat" } };

describe("resampleRequest", () => {
  it("sends the other dataset's x (blank x as null) and unit; only the preview allows a unit mismatch by itself", () => {
    const commit = resampleRequest(match, src, other);
    expect(commit).toMatchObject({ mode: "match", match_x: [0.5, null, 1.5], match_x_unit: "Oe", allow_unit_mismatch: false, unsorted: "refuse" });
    expect(resampleRequest(match, src, other, true).allow_unit_mismatch).toBe(true);
  });

  it("an accepted unit pair lets THAT mismatch through, and no other one (a replay on new files)", () => {
    const accepted: ResampleParams = { ...match, acceptedXUnits: ["K", "Oe"] };
    expect(resampleRequest(accepted, src, other).allow_unit_mismatch).toBe(true);
    const tesla = { ...other, metadata: { x_column_unit: "T" } };
    expect(resampleRequest(accepted, src, tesla).allow_unit_mismatch).toBe(false);
    const celsius = { ...src, metadata: { x_column_unit: "degC" } };
    expect(resampleRequest(accepted, celsius, other).allow_unit_mismatch).toBe(false);
  });

  it("reads the x unit under the same keys, in the same order, as the backend (xUnit, x_column_unit, xColumnUnit; trimmed)", () => {
    expect(xUnitOf({ ...src, metadata: { xUnit: " Oe " } })).toBe("Oe");
    expect(xUnitOf({ ...src, metadata: { xColumnUnit: "T" } })).toBe("T");
    expect(xUnitOf({ ...src, metadata: { x_column_unit: "  ", xUnit: "K" } })).toBe("K");
    // Key order matters when more than one is genuinely set: xUnit wins,
    // matching the backend's shared `quantized.x_units.x_unit_of`.
    expect(xUnitOf({ ...src, metadata: { x_column_unit: "Oe", xUnit: "K" } })).toBe("K");
    expect(resampleRequest(match, src, { ...other, metadata: { xUnit: "Oe" } }).match_x_unit).toBe("Oe");
    expect(xUnitConflict(src, { ...other, metadata: {} })).toBeUndefined();
    expect(xUnitConflict(src, other)).toEqual(["K", "Oe"]);
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
      { ...match, acceptedXUnits: ["K", "Oe"], sortUnsorted: true, method: "makima" },
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
    // A blanket flag (or a malformed pair) is not an acceptance of any unit pair.
    expect(() => resampleParamsOf({ ...match, acceptedXUnits: true })).toThrow("two unit names");
    expect(() => resampleParamsOf({ ...match, acceptedXUnits: ["K"] })).toThrow("two unit names");
    expect(resampleParamsOf({ ...match, allowUnitMismatch: true })).toEqual(match);
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

describe("computeResample — an out-of-range NaN fill survives a .dwk round trip", () => {
  it("the resampled dataset's null cells reopen as NaN, not a refusal", async () => {
    // The backend's own doc (lib/api/resample.ts's ResampleResult): "a blank
    // value arrives as JSON null" -- the `outOfRange: "nan"` fill for a grid
    // point outside the source's range. Stand in for that wire response.
    vi.mocked(resampleDataset).mockResolvedValue({
      dataset: {
        time: [0, 1, 2],
        values: [[1], [null as unknown as number], [3]],
        labels: ["M"], units: ["emu"], metadata: { x_column_unit: "K" },
      },
      warnings: [],
      source_range: [0, 2],
      rows_in: 3,
      rows_out: 3,
    });
    const r = await computeResample(
      { ...base, mode: "step", step: 1 },
      { name: "a.dat", data: src },
      null,
    );
    const ds: Dataset = { id: "d1", name: r.name, data: r.data };
    const reopened = parseWorkspace(serializeWorkspace({ datasets: [ds] }));
    const back = reopened.datasets[0];
    expect(Number.isNaN(back.data.values[1][0])).toBe(true);
  });
});
