// Variability's preset adapter: the shared contract plus the by-label column
// rule (a missing column skipped and named under its user-facing field name,
// the current pick kept).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { createVariabilityAdapter, type VariabilitySettings } from "./presetAdapter";

const COLUMNS = [{ index: -1, label: "T" }, { index: 0, label: "lot" }, { index: 1, label: "wafer" }, { index: 2, label: "meas" }];
const state = { responseCol: 2, factorACol: 0, factorBCol: 1 };
const adapter = createVariabilityAdapter({
  columns: () => COLUMNS,
  getPicks: () => ({ ...state }),
  setPicks: (p) => { Object.assign(state, p); },
});
const sample: VariabilitySettings = { response: "T", factorA: "wafer", factorB: "lot" };

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "response", value: 3 },
  outOfRange: { field: "factorA", value: "" },
  missingColumn: { settings: { ...sample, factorB: "ghost" }, field: "factorB", labels: COLUMNS.map((c) => c.label), required: false },
});

describe("variability adapter specifics", () => {
  it("applies picks by label, whatever the indices are", () => {
    adapter.apply(sample);
    expect(state).toEqual({ responseCol: -1, factorACol: 1, factorBCol: 0 });
  });

  it("a missing column is skipped, named by label, and that pick is kept", () => {
    Object.assign(state, { responseCol: 2, factorACol: 0, factorBCol: 1 });
    const out = adapter.apply({ response: "T", factorA: "lot", factorB: "ghost" });
    expect(out).toEqual({
      ok: true, applied: ["response", "factorA"], notes: [],
      skipped: [{ field: "factorB", reason: "column 'ghost' is not on this sheet" }],
    });
    expect(state).toEqual({ responseCol: -1, factorACol: 0, factorBCol: 1 });
    expect(adapter.fieldNames?.factorB).toBe("Factor B (nested in A)");
  });
});
