// Baseline's preset adapter: the shared contract plus what is specific to it
// (no anchors stored, automatic region edges survive JSON, bad knobs named).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { createBaselineAdapter, settingsFrom, type BaselineSettings } from "./presetAdapter";
import type { BaselineMethod, BaselineParams } from "./useBaseline";

const state: { method: BaselineMethod; params: BaselineParams } = {
  method: "als",
  params: { lam: 1e6, p: 0.01, radius: 100, order: 5, maxWindowDeg: 2, regionXMin: NaN, regionXMax: NaN, regionYMin: NaN, regionYMax: NaN, maxIter: 50, anchorMethod: "pchip" },
};
const adapter = createBaselineAdapter({
  getMethod: () => state.method, getParams: () => state.params,
  setMethod: (m) => { state.method = m; }, setParams: (patch) => { state.params = { ...state.params, ...patch }; },
});
const sample: BaselineSettings = {
  method: "region", lam: 2e5, p: 0.2, radius: 30, order: 3, maxWindowDeg: 0.7,
  regionXMin: 10, regionXMax: 20, regionYMin: -1.5, regionYMax: null, maxIter: 12, anchorMethod: "spline",
};

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "lam", value: "big" },
  outOfRange: { field: "p", value: 1.5 },
});

describe("baseline adapter specifics", () => {
  it("automatic region edges (NaN in the panel) are stored as null and come back as NaN", () => {
    adapter.apply({ ...sample, regionXMin: null, regionXMax: null, regionYMin: null, regionYMax: null });
    expect(Number.isNaN(state.params.regionXMin)).toBe(true);
    const captured = adapter.capture();
    expect(captured.regionXMin).toBeNull();
    expect(JSON.parse(JSON.stringify(captured))).toEqual(captured);
  });

  it("stores no anchors, and says so when an anchor preset is applied", () => {
    expect(Object.keys(settingsFrom("anchor", state.params))).not.toContain("anchors");
    const out = adapter.apply({ ...sample, method: "anchor" });
    expect(out).toMatchObject({ ok: true, notes: [expect.stringContaining("anchor points")] });
  });

  it("rejects each bad knob with its field named", () => {
    const base = adapter.defaults();
    expect(adapter.parse({ ...base, radius: 0 })).toEqual({ error: "setting 'radius' must be a whole number of 1 or more" });
    expect(adapter.parse({ ...base, method: "magic" })).toMatchObject({ error: expect.stringContaining("'method'") });
    expect(adapter.parse({ ...base, regionXMin: "auto" })).toMatchObject({ error: expect.stringContaining("'regionXMin'") });
    expect(adapter.parse({ ...base, anchorMethod: "cubic" })).toMatchObject({ error: expect.stringContaining("'anchorMethod'") });
  });
});
