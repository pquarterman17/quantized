// The SIMS batch region table's pure rules: the fail-closed refusals (depth
// unit mismatch, missing / ambiguous species, non-finite data, blanks unless
// bridging is opted in) and the summary worksheet's shape and unit checks.

import { describe, expect, it, vi } from "vitest";

import type { SimsRegionResult } from "../../../lib/api/sims";
import type { DataStruct, Dataset } from "../../../lib/types";
import type { AnalysisBatchRow } from "../analysisselection/AnalysisBatchControls";
import {
  depthUnitProblem, profileProblem, regionBatchColumns, regionBatchRow, regionSummaryData, runRegionBatchItem,
} from "./simsRegionBatch";
import type { RegionForm } from "./useSimsRegion";

vi.mock("../../../lib/api/sims", () => ({ measureSimsRegion: vi.fn() }));
const { measureSimsRegion } = await import("../../../lib/api/sims");

const struct = (over: Partial<DataStruct> = {}): DataStruct => ({
  time: [0, 10, 20, 30], values: [[1, 5], [3, 5], [5, 5], [3, 5]], labels: ["B", "Si"], units: ["atoms/cm3", "atoms/cm3"],
  metadata: { x_column_name: "Depth", x_column_unit: "nm" }, ...over,
});
const sheet = (id: string, data: DataStruct): Dataset => ({ id, name: `${id}.csv`, data });
const form: RegionForm = { lo: "0", hi: "30", species: ["B"], mode: "fraction", threshold: "50" };

const result = (over: Record<string, unknown> = {}, species: Record<string, unknown> = {}): SimsRegionResult => ({
  region: [0, 30], x_name: "Depth", x_unit: "nm", rows_in_region: 4, method: {}, csv: "", warnings: [],
  species: [{
    name: "B", unit: "atoms/cm3", points: 4, blank: 0, integral: 1.5e-4, integral_unit: "atoms/cm^2", integral_kind: "areal-dose",
    integrated_from: 0, integrated_to: 30, peak: 5, peak_depth: 20, mean: 3, threshold: 2.5, crossings: [],
    junction_depth: 31, junction_direction: "falling", ...species,
  }],
  ...over,
} as SimsRegionResult);

describe("depthUnitProblem", () => {
  it("passes when every profile shares the region's unit", () => {
    expect(depthUnitProblem([sheet("a", struct()), sheet("b", struct())], "nm")).toBeNull();
  });
  it("refuses a profile in another unit, or with none, naming it", () => {
    const a = struct({ metadata: { x_column_unit: "A" } });
    const none = struct({ metadata: {} });
    const msg = depthUnitProblem([sheet("a", a), sheet("n", none), sheet("b", struct())], "nm");
    expect(msg).toContain("a.csv (A)");
    expect(msg).toContain("n.csv (no unit)");
    expect(msg).not.toContain("b.csv");
  });
});

describe("profileProblem", () => {
  it("accepts a clean profile", () => expect(profileProblem(struct(), ["B", "Si"])).toBeNull());
  it("refuses a missing species", () => expect(profileProblem(struct(), ["P"])).toBe('this profile has no species "P"'));
  it("refuses two columns of one name", () => {
    expect(profileProblem(struct({ labels: ["B", "B"] }), ["B"])).toContain("2 columns named");
  });
  it("refuses an infinite value and a non-finite depth", () => {
    expect(profileProblem(struct({ values: [[1, 5], [Infinity, 5], [5, 5], [3, 5]] }), ["B"])).toContain("infinite");
    expect(profileProblem(struct({ time: [0, Number.NaN, 20, 30] }), ["B"])).toContain("depth column");
  });
  it("does not refuse a blank (NaN) value here: that is the blank rule's call", () => {
    expect(profileProblem(struct({ values: [[1, 5], [Number.NaN, 5], [5, 5], [3, 5]] }), ["B"])).toBeNull();
  });
});

describe("regionBatchRow", () => {
  it("lays the backend's measures out in the table's column order", () => {
    const { values, warnings } = regionBatchRow(result(), ["B"], "nm", false);
    expect(regionBatchColumns(["B"])).toEqual([
      "Depth unit", "B integral", "B integral unit", "B peak", "B peak depth", "B mean", "B value unit", "B junction depth",
    ]);
    expect(values).toEqual(["nm", 1.5e-4, "atoms/cm^2", 5, 20, 3, "atoms/cm3", 31]);
    expect(warnings).toEqual([]);
  });
  it("keeps a missing junction as a blank, not a number", () => {
    expect(regionBatchRow(result({}, { junction_depth: null }), ["B"], "nm", false).values.at(-1)).toBeNull();
  });
  it("refuses a result in another depth unit", () => {
    expect(() => regionBatchRow(result({ x_unit: "A" }), ["B"], "nm", false)).toThrow(/depth unit is A, not nm/);
  });
  it("refuses a species with no finite value in the region", () => {
    expect(() => regionBatchRow(result({}, { points: 0 }), ["B"], "nm", false)).toThrow(/no finite value/);
  });
  it("refuses blank samples unless bridging is allowed", () => {
    expect(() => regionBatchRow(result({}, { blank: 2 }), ["B"], "nm", false)).toThrow(/2 blank samples/);
    expect(regionBatchRow(result({}, { blank: 2 }), ["B"], "nm", true).values[1]).toBe(1.5e-4);
  });
  it("refuses a species the backend did not return", () => {
    expect(() => regionBatchRow(result(), ["P"], "nm", false)).toThrow(/no result for "P"/);
  });
  it("carries the backend's non-informational warnings", () => {
    const r = result({ warnings: [{ code: "single-point", text: "only one" }, { code: "no-crossing", text: "info", info: true }] });
    expect(regionBatchRow(r, ["B"], "nm", false).warnings).toEqual(["only one"]);
  });
});

describe("runRegionBatchItem", () => {
  it("never posts a profile that fails the up-front checks", async () => {
    vi.mocked(measureSimsRegion).mockClear();
    await expect(runRegionBatchItem(sheet("a", struct()), { form, species: ["P"], xUnit: "nm", allowBlanks: false }))
      .rejects.toThrow(/no species "P"/);
    expect(measureSimsRegion).not.toHaveBeenCalled();
  });
  it("posts the Region request on the profile's own column index and returns the row", async () => {
    vi.mocked(measureSimsRegion).mockResolvedValueOnce(result());
    const swapped = struct({ labels: ["Si", "B"], values: [[5, 1], [5, 3], [5, 5], [5, 3]] });
    const out = await runRegionBatchItem(sheet("a", swapped), { form, species: ["B"], xUnit: "nm", allowBlanks: false });
    const body = vi.mocked(measureSimsRegion).mock.calls.at(-1)![0];
    expect(body.columns).toEqual([1]);
    expect([body.lo, body.hi, body.threshold_mode, body.threshold]).toEqual([0, 30, "fraction", 0.5]);
    expect(out.values[0]).toBe("nm");
  });
});

const row = (id: string, values: (string | number | null)[], status: AnalysisBatchRow["status"] = "completed"): AnalysisBatchRow =>
  ({ datasetId: id, name: `${id}.csv`, rows: 4, status, values, warning: null });
const V = (depth: string, integral = 1, vu = "atoms/cm3"): (string | number | null)[] =>
  [depth, integral, "atoms/cm^2", 5, 20, 3, vu, 31];

describe("regionSummaryData", () => {
  it("builds one numeric row per profile with each column's own unit", () => {
    const out = regionSummaryData([row("a", V("nm", 1)), row("b", V("nm", 2))], ["B"], form, false);
    if (!("data" in out)) throw new Error(out.refused);
    expect(out.data.labels).toEqual(["B integral", "B peak", "B peak depth", "B mean", "B junction depth"]);
    expect(out.data.units).toEqual(["atoms/cm^2", "atoms/cm3", "nm", "atoms/cm3", "nm"]);
    expect(out.data.values).toEqual([[1, 5, 20, 3, 31], [2, 5, 20, 3, 31]]);
    expect(out.data.time).toEqual([1, 2]);
    expect(out.data.metadata["source"]).toBe("sims-region-batch");
  });
  it("refuses when any profile did not complete", () => {
    const out = regionSummaryData([row("a", V("nm")), row("b", [], "failed")], ["B"], form, false);
    expect(out).toMatchObject({ refused: expect.stringContaining("b.csv (failed") });
  });
  it("refuses mixed depth units and mixed value units", () => {
    expect(regionSummaryData([row("a", V("nm")), row("b", V("A"))], ["B"], form, false)).toMatchObject({ refused: expect.stringContaining("depth units differ") });
    expect(regionSummaryData([row("a", V("nm")), row("b", V("nm", 1, "c/s"))], ["B"], form, false))
      .toMatchObject({ refused: expect.stringContaining("different units") });
  });
  it("turns a blank junction into NaN, never zero", () => {
    const v = V("nm"); v[7] = null;
    const out = regionSummaryData([row("a", v)], ["B"], form, false);
    if (!("data" in out)) throw new Error(out.refused);
    expect(Number.isNaN(out.data.values[0]![4])).toBe(true);
  });
});
