// Multivariate's preset adapter: the shared contract plus what is specific to it
// (columns by label, a missing one skipped and named, too few refused with
// nothing written, PC axes bounded by the columns, the method list the toggle uses).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { CORR_METHODS } from "./multivarMethods";
import { createMultivarAdapter, type MultivarSettings } from "./presetAdapter";

const COLUMNS = [{ index: -1, label: "T" }, { index: 0, label: "a" }, { index: 1, label: "b" }, { index: 2, label: "c" }];
const state = { selected: [0, 1], method: "pearson" as "pearson" | "spearman", standardize: false, pcX: 0, pcY: 1 };
const adapter = createMultivarAdapter({
  columns: () => COLUMNS,
  getSelected: () => state.selected, setSelected: (c) => { state.selected = c; },
  getMethod: () => state.method, setMethod: (m) => { state.method = m; },
  getStandardize: () => state.standardize, setStandardize: (b) => { state.standardize = b; },
  getPc: () => ({ pcX: state.pcX, pcY: state.pcY }), setPc: (x, y) => { state.pcX = x; state.pcY = y; },
});
const sample: MultivarSettings = { columns: ["T", "b", "c"], method: "spearman", standardize: true, pcX: 2, pcY: 0 };

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "standardize", value: "yes" },
  outOfRange: { field: "pcX", value: 3 },
});

describe("multivar adapter specifics", () => {
  it("stores columns by label, never by index", () => {
    state.selected = [-1, 2];
    expect(adapter.capture().columns).toEqual(["T", "c"]);
  });

  it("every correlation method the toggle offers is accepted", () => {
    for (const method of CORR_METHODS) expect(adapter.parse({ ...sample, method }), method).not.toHaveProperty("error");
    expect(adapter.parse({ ...sample, method: "kendall" })).toEqual({ error: expect.stringContaining("'method'") });
  });

  it("skips a missing column naming its label, and applies the rest", () => {
    state.selected = [0, 1];
    const out = adapter.apply({ ...sample, columns: ["a", "ghost", "c"], pcX: 0, pcY: 1 });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "columns", reason: "column 'ghost' is not on this sheet" }] });
    expect(state.selected).toEqual([0, 2]);
    expect(state.method).toBe("spearman");
  });

  it("refuses, writing nothing, when fewer than two columns remain", () => {
    state.selected = [0, 1];
    state.method = "pearson";
    const out = adapter.apply({ ...sample, columns: ["a", "ghost"], method: "spearman" });
    expect(out).toEqual({ ok: false, reason: expect.stringContaining("'ghost'") });
    expect(state.selected).toEqual([0, 1]);
    expect(state.method).toBe("pearson");
  });

  it("a PC axis beyond the columns left is skipped and the current axis kept", () => {
    state.selected = [0, 1];
    state.pcX = 0;
    state.pcY = 1;
    const out = adapter.apply({ ...sample, columns: ["a", "ghost", "c"], pcX: 2, pcY: 0 });
    expect(out).toMatchObject({ ok: true, skipped: expect.arrayContaining([{ field: "pcX", reason: expect.stringContaining("component 3") }]) });
    expect(state.pcX).toBe(0);
    expect(state.pcY).toBe(0);
  });

  it("rejects fewer than two columns, a repeat and an axis past the list, naming the field", () => {
    expect(adapter.parse({ ...sample, columns: ["a"] })).toEqual({ error: expect.stringContaining("'columns'") });
    expect(adapter.parse({ ...sample, columns: ["a", "a"] })).toEqual({ error: expect.stringContaining("'columns'") });
    expect(adapter.parse({ ...sample, columns: ["a", "b"], pcX: 0, pcY: 2 })).toEqual({ error: expect.stringContaining("'pcY'") });
  });
});
