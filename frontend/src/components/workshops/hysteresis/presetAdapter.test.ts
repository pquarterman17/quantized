// Hysteresis' preset adapter: the shared contract plus what is specific to it
// (the trend axis only, a missing source skipped and named, nothing that names
// a worksheet).

import { describe, expect, it } from "vitest";

import { genericBackend } from "../../../lib/presets";
import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { createHysteresisAdapter, type HysteresisSettings } from "./presetAdapter";

const axis = {
  axisSource: "", axisLabel: "", axisUnit: "",
  candidateKeys: ["metadata:sample_temperature", "column:field-angle"] as readonly string[],
  applyAxis(source: string, label: string, unit: string) { axis.axisSource = source; axis.axisLabel = label; axis.axisUnit = unit; },
};
const adapter = createHysteresisAdapter(axis);
const sample: HysteresisSettings = { axisSource: "metadata:sample_temperature", axisLabel: "T sweep", axisUnit: "K" };

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "axisLabel", value: 5 },
  outOfRange: { field: "axisSource", value: "temperature" },
});

describe("hysteresis adapter specifics", () => {
  it("accepts the fixed entries and both kinds of candidate key", () => {
    for (const axisSource of ["", "__manual__", "metadata:temperature", "column:field-angle"]) {
      const label = axisSource === "" ? "" : "x";
      expect(adapter.parse({ axisSource, axisLabel: label, axisUnit: "" }), axisSource).not.toHaveProperty("error");
    }
  });

  it("rejects an unknown source kind, an overlong label and a label with no source, naming the field", () => {
    expect(adapter.parse({ ...sample, axisSource: "filename:run3" })).toMatchObject({ error: expect.stringContaining("'axisSource'") });
    expect(adapter.parse({ ...sample, axisSource: "metadata:" })).toMatchObject({ error: expect.stringContaining("'axisSource'") });
    expect(adapter.parse({ ...sample, axisLabel: "x".repeat(121) })).toMatchObject({ error: expect.stringContaining("'axisLabel'") });
    expect(adapter.parse({ axisSource: "", axisLabel: 4, axisUnit: "" })).toMatchObject({ error: expect.stringContaining("'axisLabel'") });
  });

  it("a source the selected worksheets lack is skipped and named by its user-facing label, and nothing changes", () => {
    axis.axisSource = ""; axis.axisLabel = ""; axis.axisUnit = "";
    const out = adapter.apply({ axisSource: "metadata:ghost_field", axisLabel: "G", axisUnit: "T" });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "axisSource", reason: expect.stringContaining("'Ghost Field' is not on the selected worksheets") }] });
    expect(axis.axisSource).toBe("");
    const col = adapter.apply({ axisSource: "column:missing-angle", axisLabel: "A", axisUnit: "" });
    expect(col).toMatchObject({ skipped: [{ reason: expect.stringContaining("'missing angle'") }] });
  });

  it("stores only the axis: no worksheet, no typed values", () => {
    expect(Object.keys(adapter.capture()).sort()).toEqual(["axisLabel", "axisSource", "axisUnit"]);
    expect(adapter.parse({ ...sample, values: { d1: 3 } })).toMatchObject({ error: expect.stringContaining("'values'") });
  });

  it("a manual axis applies and says the values are not stored", () => {
    const out = adapter.apply({ axisSource: "__manual__", axisLabel: "Series variable", axisUnit: "" });
    expect(out).toMatchObject({ ok: true, notes: [expect.stringContaining("does not store them")] });
    expect(axis.axisSource).toBe("__manual__");
  });

  it("the label and unit are hidden while no source is chosen: a refused value there neither blocks Save nor is stored", () => {
    expect(adapter.parse({ axisSource: "", axisLabel: "T", axisUnit: "K" })).not.toHaveProperty("error");
    expect(adapter.parse({ axisSource: "", axisLabel: "x".repeat(120), axisUnit: "y".repeat(40) })).not.toHaveProperty("error");
    expect(adapter.parse({ axisSource: "metadata:sample_temperature", axisLabel: "", axisUnit: "x".repeat(41) })).toMatchObject({ error: expect.stringContaining("'axisUnit'") });
    axis.axisSource = ""; axis.axisLabel = "x".repeat(300); axis.axisUnit = "stale";
    const captured = adapter.capture();
    expect(captured).toEqual({ axisSource: "", axisLabel: "", axisUnit: "" });
    expect(adapter.parse(captured)).not.toHaveProperty("error");
    localStorage.clear();
    expect(genericBackend(adapter).save("hidden", adapter.capture())).toMatchObject({ ok: true });
    localStorage.clear();
    adapter.apply({ axisSource: "", axisLabel: "left over", axisUnit: "K" });
    expect(axis).toMatchObject({ axisSource: "", axisLabel: "", axisUnit: "" });
  });
});
