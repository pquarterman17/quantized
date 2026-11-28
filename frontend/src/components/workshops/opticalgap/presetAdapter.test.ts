// Optical gap's preset adapter: the shared contract plus what is specific to it
// (every option the panel offers is accepted, columns by label, the hidden-field
// rule for thickness and the transmittance scale, the fit window rule, nothing
// that names data).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { TAUC_SIGNAL_OPTIONS, TAUC_TRANSITION_OPTIONS, TAUC_X_UNIT_OPTIONS } from "./opticalGapOptions";
import { createOpticalGapAdapter, type OpticalGapHandle, type OpticalGapPreset } from "./presetAdapter";

const handle: OpticalGapHandle & { held: string | null } = {
  columns: [{ index: -1, label: "Energy" }, { index: 0, label: "alpha" }, { index: 1, label: "T" }, { index: 2, label: "dup" }, { index: 3, label: "dup" }],
  xCol: -1, yCol: 0, xUnit: "eV", signal: "alpha", percent: false, thickness: "", kind: "direct", eMin: "", eMax: "", held: null,
  setXCol(i) { handle.xCol = i; },
  setYCol(i) { handle.yCol = i; },
  holdGuessFor(x, y) { handle.held = `${x}:${y}`; },
  setXUnit(u) { handle.xUnit = u; },
  setSignal(s) { handle.signal = s; },
  setPercent(p) { handle.percent = p; },
  setThickness(v) { handle.thickness = v; },
  setKind(k) { handle.kind = k; },
  setEMin(v) { handle.eMin = v; },
  setEMax(v) { handle.eMax = v; },
};
const adapter = createOpticalGapAdapter(handle);

const sample: OpticalGapPreset = {
  xColumn: "Energy", yColumn: "T", xUnit: "nm", signal: "transmittance", percent: true, thickness: "250", kind: "indirect", eMin: "2.1", eMax: "3.4",
};

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "percent", value: "yes" },
  outOfRange: { field: "kind", value: "magic" },
  missingColumn: { settings: { ...sample, yColumn: "ghost" }, field: "yColumn", labels: ["Energy", "alpha"], required: false },
});

const parse = (patch: Record<string, unknown>) => adapter.parse({ ...sample, ...patch });

describe("Optical gap adapter specifics", () => {
  it("every option list the panel offers is accepted", () => {
    for (const o of TAUC_X_UNIT_OPTIONS) expect(parse({ xUnit: o.value }), o.value).not.toHaveProperty("error");
    for (const o of TAUC_SIGNAL_OPTIONS) expect(parse({ signal: o.value }), o.value).not.toHaveProperty("error");
    for (const o of TAUC_TRANSITION_OPTIONS) expect(parse({ kind: o.value }), o.value).not.toHaveProperty("error");
  });

  it("rejects each bad value with its field named", () => {
    expect(parse({ xUnit: "keV" })).toMatchObject({ error: expect.stringContaining("'xUnit'") });
    expect(parse({ thickness: "-1" })).toMatchObject({ error: expect.stringContaining("'thickness'") });
    expect(parse({ eMin: "abc" })).toMatchObject({ error: expect.stringContaining("'eMin'") });
    expect(parse({ eMin: "3.4", eMax: "2.1" })).toMatchObject({ error: expect.stringContaining("'eMin'") });
    expect(parse({ eMin: "", eMax: "2.1" })).not.toHaveProperty("error");
    expect(parse({ xColumn: "" })).toMatchObject({ error: expect.stringContaining("'xColumn'") });
  });

  it("thickness and the T scale are hidden by the signals that do not use them", () => {
    expect(parse({ signal: "alpha", thickness: "-1", percent: true })).not.toHaveProperty("error");
    expect(parse({ signal: "alpha", thickness: 3 })).toMatchObject({ error: expect.stringContaining("'thickness'") }); // a wrong KIND is still refused
    expect(parse({ signal: "absorbance", percent: "maybe" })).toMatchObject({ error: expect.stringContaining("'percent'") }); // hidden, but still the wrong KIND
  });

  it("capture stores the default for a refused hidden value, and Apply never writes one", () => {
    Object.assign(handle, { signal: "alpha", thickness: "-5", percent: false });
    expect(adapter.capture()).toMatchObject({ signal: "alpha", thickness: "" });
    handle.thickness = "100";
    handle.signal = "alpha";
    adapter.apply({ ...sample, signal: "alpha", thickness: "-1", percent: false });
    expect(handle.thickness).toBe("100"); // the current value stays: the preset's was refused and is hidden
  });

  it("a missing or repeated column is skipped and named, and the pick and the guess hold stay", () => {
    Object.assign(handle, { xCol: -1, yCol: 0, held: null });
    expect(adapter.apply({ ...sample, yColumn: "ghost" })).toMatchObject({ ok: true, skipped: [{ field: "yColumn", reason: "column 'ghost' is not on this sheet" }] });
    expect(handle.yCol).toBe(0);
    expect(adapter.apply({ ...sample, yColumn: "dup" })).toMatchObject({ ok: true, skipped: [{ field: "yColumn", reason: expect.stringContaining("more than once") }] });
    expect(handle.yCol).toBe(0);
    expect(handle.held).toBeNull(); // the picks did not move, so nothing needs holding

    adapter.apply({ ...sample, yColumn: "T" });
    expect(handle.yCol).toBe(1);
    expect(handle.held).toBe("-1:1");
  });

  it("stores no dataset or row range", () => {
    expect(Object.keys(adapter.capture()).sort()).toEqual(["eMax", "eMin", "kind", "percent", "signal", "thickness", "xColumn", "xUnit", "yColumn"]);
    expect(adapter.parse({ ...sample, datasetId: "a" })).toMatchObject({ error: expect.stringContaining("'datasetId'") });
  });
});
