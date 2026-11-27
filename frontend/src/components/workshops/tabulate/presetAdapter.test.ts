// Tabulate's preset adapter: the shared contract plus what is specific to it
// (columns by label, a missing one skipped and named, a layout with no group-by
// or value column refused with nothing written, the statistic list the picker uses).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { STAT_KEYS } from "../../../lib/tabulate";
import { createTabulateAdapter, type TabulateSettings } from "./presetAdapter";
import type { TabulateLayout } from "./useTabulate";

const COLUMNS = [{ index: -1, label: "T" }, { index: 0, label: "grp" }, { index: 1, label: "site" }, { index: 2, label: "val" }];
const state: { layout: TabulateLayout } = { layout: { groupCols: [0], valueCols: [2], statKeys: ["count", "mean"], grandTotal: false } };
const adapter = createTabulateAdapter({
  columns: () => COLUMNS,
  getLayout: () => state.layout,
  setLayout: (l) => { state.layout = l; },
});
const sample: TabulateSettings = { groupCols: ["site", "grp"], valueCols: ["val", "T"], statKeys: ["count", "mean", "sd"], grandTotal: true };

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "grandTotal", value: "on" },
  outOfRange: { field: "groupCols", value: ["a", "b", "c", "d"] },
});

describe("tabulate adapter specifics", () => {
  it("every statistic the picker offers is accepted; an unknown one is rejected", () => {
    expect(adapter.parse({ ...sample, statKeys: [...STAT_KEYS] })).not.toHaveProperty("error");
    expect(adapter.parse({ ...sample, statKeys: ["mean", "kurtosis"] })).toEqual({ error: expect.stringContaining("'statKeys'") });
  });

  it("stores columns by label and applies them by label", () => {
    adapter.apply(sample);
    expect(state.layout.groupCols).toEqual([1, 0]);
    expect(state.layout.valueCols).toEqual([2, -1]);
  });

  it("skips a missing column naming its label and applies the rest", () => {
    const out = adapter.apply({ ...sample, groupCols: ["grp"], valueCols: ["val", "ghost"] });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "valueCols", reason: "column 'ghost' is not on this sheet" }] });
    expect(state.layout.valueCols).toEqual([2]);
  });

  it("refuses, writing nothing, when no group-by or no value column is on the sheet", () => {
    const before = state.layout;
    expect(adapter.apply({ ...sample, groupCols: ["ghost"] })).toEqual({ ok: false, reason: expect.stringContaining("group-by columns") });
    expect(adapter.apply({ ...sample, valueCols: ["ghost"] })).toEqual({ ok: false, reason: expect.stringContaining("value columns") });
    expect(state.layout).toBe(before);
  });
});
