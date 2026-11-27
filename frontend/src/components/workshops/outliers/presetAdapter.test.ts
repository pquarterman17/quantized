// Outlier screening's preset adapter: the shared contract plus what is specific
// to it (every method the panel offers is accepted, bad numbers are rejected
// with the field named, no column or data is stored).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { createOutlierAdapter, type OutlierSettings } from "./presetAdapter";
import { OUTLIER_METHODS, type OutlierMethod } from "./useOutlierScreening";

const state = { method: "grubbs" as OutlierMethod, threshold: 3.5, alpha: 0.05, k: 2 };
const adapter = createOutlierAdapter({
  get method() { return state.method; },
  setMethod: (m) => { state.method = m; },
  get threshold() { return state.threshold; },
  setThreshold: (t) => { state.threshold = t; },
  get alpha() { return state.alpha; },
  setAlpha: (a) => { state.alpha = a; },
  get k() { return state.k; },
  setK: (k) => { state.k = k; },
});
const sample: OutlierSettings = { method: "rosner", threshold: 4.2, alpha: 0.01, k: 5 };

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "alpha", value: "small" },
  outOfRange: { field: "alpha", value: 1.5 },
});

describe("outlier adapter specifics", () => {
  it("checks only the fields the method shows; a hidden bad value is neither refused nor stored", () => {
    expect(adapter.parse({ ...sample, method: "grubbs", threshold: -1, k: 0 })).not.toHaveProperty("error");
    expect(adapter.parse({ ...sample, method: "mad", alpha: 7, k: 0 })).not.toHaveProperty("error");
    expect(adapter.parse({ ...sample, method: "rosner", threshold: 0 })).not.toHaveProperty("error");
    expect(adapter.parse({ ...sample, method: "grubbs", threshold: "x" })).toMatchObject({ error: expect.stringContaining("'threshold'") });
    Object.assign(state, { method: "grubbs", threshold: -3, alpha: 0.05, k: 0 });
    expect(adapter.capture()).toEqual({ method: "grubbs", threshold: 3.5, alpha: 0.05, k: 2 });
    Object.assign(state, { method: "mad", alpha: 9, threshold: 4 });
    expect(adapter.capture()).toMatchObject({ method: "mad", threshold: 4, alpha: expect.any(Number) });
    expect(adapter.capture().alpha).toBeLessThan(1);
  });

  it("every method the panel offers is accepted", () => {
    expect(OUTLIER_METHODS).toHaveLength(4);
    for (const m of OUTLIER_METHODS) expect(adapter.parse({ ...sample, method: m.value }), m.value).not.toHaveProperty("error");
  });

  it("rejects each bad value with its field named", () => {
    expect(adapter.parse({ ...sample, method: "tukey" })).toMatchObject({ error: expect.stringContaining("'method'") });
    expect(adapter.parse({ ...sample, method: "mad", threshold: 0 })).toMatchObject({ error: expect.stringContaining("'threshold'") });
    expect(adapter.parse({ ...sample, k: 2.5 })).toMatchObject({ error: expect.stringContaining("'k'") });
    expect(adapter.parse({ ...sample, k: 0 })).toMatchObject({ error: expect.stringContaining("'k'") });
    expect(adapter.parse({ ...sample, alpha: 0 })).toMatchObject({ error: expect.stringContaining("'alpha'") });
  });

  it("stores no channel, row or dataset", () => {
    expect(Object.keys(adapter.capture()).sort()).toEqual(["alpha", "k", "method", "threshold"]);
    expect(adapter.parse({ ...sample, channel: "y" })).toMatchObject({ error: expect.stringContaining("'channel'") });
  });
});
