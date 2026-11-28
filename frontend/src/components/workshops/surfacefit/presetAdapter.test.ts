// Surface fit's preset adapter: the shared contract plus what is specific to it
// (columns by label, a model the backend does not list is skipped and named, the
// start values and bounds are not part of a preset, nothing that names data).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { createSurfaceFitAdapter, type SurfaceFitHandle, type SurfaceFitPreset } from "./presetAdapter";

const MODELS = [{ name: "Plane", param_names: ["a", "b", "c"], description: "" }, { name: "Paraboloid", param_names: ["a"], description: "" }];
const handle: SurfaceFitHandle = {
  columns: [{ index: -1, label: "X" }, { index: 0, label: "Y" }, { index: 1, label: "Z" }, { index: 2, label: "dup" }, { index: 3, label: "dup" }],
  xCol: -1, yCol: 0, zCol: 1, models: MODELS, model: MODELS[0]!,
  setXCol(i) { handle.xCol = i; },
  setYCol(i) { handle.yCol = i; },
  setZCol(i) { handle.zCol = i; },
  setModelName(n) { handle.model = MODELS.find((m) => m.name === n) ?? handle.model; },
};
const adapter = createSurfaceFitAdapter(handle);

const sample: SurfaceFitPreset = { xColumn: "Z", yColumn: "X", zColumn: "Y", model: "Paraboloid" };

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "model", value: 4 },
  outOfRange: { field: "xColumn", value: "" },
  missingColumn: { settings: { ...sample, zColumn: "ghost" }, field: "zColumn", labels: ["X", "Y", "Z"], required: false },
});

describe("Surface fit adapter specifics", () => {
  it("a model the backend does not list is skipped and named, and the rest applies", () => {
    Object.assign(handle, { xCol: -1, yCol: 0, zCol: 1, model: MODELS[0] });
    const out = adapter.apply({ ...sample, model: "Gaussian bump" });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "model", reason: "model 'Gaussian bump' is not available" }] });
    expect(handle.model?.name).toBe("Plane");
    expect(handle.xCol).toBe(1);
  });

  it("a missing or repeated column is skipped and named, and the pick stays", () => {
    Object.assign(handle, { xCol: -1, yCol: 0, zCol: 1 });
    expect(adapter.apply({ ...sample, zColumn: "ghost" })).toMatchObject({ ok: true, skipped: [{ field: "zColumn", reason: "column 'ghost' is not on this sheet" }] });
    expect(handle.zCol).toBe(1);
    expect(adapter.apply({ ...sample, yColumn: "dup" })).toMatchObject({ ok: true, skipped: [{ field: "yColumn", reason: expect.stringContaining("more than once") }] });
    expect(handle.yCol).toBe(-1); // the X pick applied (by label "Z" -> index 1 then "X" -> -1): only the repeated one is left alone
  });

  it("Apply says start values and bounds are the panel's own", () => {
    expect(adapter.apply(sample)).toMatchObject({ ok: true, notes: [expect.stringContaining("start values")] });
  });

  it("stores no start values, bounds, dataset or row range", () => {
    expect(Object.keys(adapter.capture()).sort()).toEqual(["model", "xColumn", "yColumn", "zColumn"]);
    expect(adapter.parse({ ...sample, p0: ["1"] })).toMatchObject({ error: expect.stringContaining("'p0'") });
    expect(adapter.parse({ ...sample, datasetId: "d1" })).toMatchObject({ error: expect.stringContaining("'datasetId'") });
  });
});
