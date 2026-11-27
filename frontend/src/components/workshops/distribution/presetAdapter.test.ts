// Distribution's preset adapter: the shared contract plus what is specific to
// it (the column is stored by label, a missing or duplicated label is skipped
// and named, every fit family the panel offers is accepted, bad numbers are
// rejected with the field named).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { DIST_FAMILIES } from "../../../lib/distpdf";
import { FIT_OPTIONS, FIT_PICKS } from "./fitPicks";
import { createDistributionAdapter, type DistributionPanelHandle, type DistributionSettings } from "./presetAdapter";

const state = {
  columns: [{ index: -1, label: "T" }, { index: 0, label: "v" }, { index: 1, label: "w" }],
  col: 0,
  byCol: null as number | null,
  fitDist: "none" as DistributionPanelHandle["fitDist"],
  compareOpen: false,
  percentileInput: 90,
  ci: { percent: 95, bootstrap: false },
};
const handle: DistributionPanelHandle = {
  get columns() { return state.columns; },
  get col() { return state.col; },
  setCol: (i) => { state.col = i; },
  get byCol() { return state.byCol; },
  get fitDist() { return state.fitDist; },
  setFitDist: (d) => { state.fitDist = d; },
  get compareOpen() { return state.compareOpen; },
  setCompareOpen: (o) => { state.compareOpen = o; },
  get percentileInput() { return state.percentileInput; },
  setPercentileInput: (p) => { state.percentileInput = p; },
  ci: {
    get percent() { return state.ci.percent; },
    setPercent: (p) => { state.ci.percent = p; },
    get bootstrap() { return state.ci.bootstrap; },
    setBootstrap: (b) => { state.ci.bootstrap = b; },
  },
};
const adapter = createDistributionAdapter(handle);
const sample: DistributionSettings = { column: "w", fitDist: "weibull", compareOpen: true, percentile: 75, ciPercent: 99, ciBootstrap: true };

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "percentile", value: "high" },
  outOfRange: { field: "ciPercent", value: 120 },
  missingColumn: { settings: { ...sample, column: "Pressure" }, field: "column", labels: ["T", "v", "w"], required: false },
});

describe("distribution adapter specifics", () => {
  it("every fit choice the panel offers is accepted, and the list is the family list plus None", () => {
    expect(FIT_OPTIONS.map((o) => o.value)).toEqual(["none", ...DIST_FAMILIES]);
    expect(FIT_PICKS).toHaveLength(DIST_FAMILIES.length + 1);
    for (const o of FIT_OPTIONS) expect(adapter.parse({ ...sample, fitDist: o.value }), o.value).not.toHaveProperty("error");
  });

  it("rejects each bad value with its field named", () => {
    expect(adapter.parse({ ...sample, fitDist: "cauchy2" })).toMatchObject({ error: expect.stringContaining("'fitDist'") });
    expect(adapter.parse({ ...sample, percentile: 100 })).toMatchObject({ error: expect.stringContaining("'percentile'") });
    expect(adapter.parse({ ...sample, percentile: 0 })).toMatchObject({ error: expect.stringContaining("'percentile'") });
    expect(adapter.parse({ ...sample, ciPercent: 10 })).toMatchObject({ error: expect.stringContaining("'ciPercent'") });
    expect(adapter.parse({ ...sample, column: "" })).toMatchObject({ error: expect.stringContaining("'column'") });
    expect(adapter.parse({ ...sample, ciBootstrap: "yes" })).toMatchObject({ error: expect.stringContaining("'ciBootstrap'") });
  });

  it("a column label missing on the sheet is skipped and named by its label; the rest applies", () => {
    state.col = 0;
    const out = adapter.apply({ ...sample, column: "Pressure" });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "column", reason: "column 'Pressure' is not on this sheet" }] });
    expect(state.col).toBe(0);
    expect(state.fitDist).toBe("weibull");
    expect(out.ok && out.applied).not.toContain("column");
  });

  it("the X column is stored by its name and a duplicated label is skipped, not guessed", () => {
    state.col = -1;
    expect(adapter.capture().column).toBe("T");
    state.columns = [...state.columns, { index: 2, label: "v" }];
    state.col = 1;
    const out = adapter.apply({ ...sample, column: "v" });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "column", reason: expect.stringContaining("more than once") }] });
    expect(state.col).toBe(1);
    state.columns = state.columns.slice(0, 3);
  });

  it("says when a By column hides the fit controls", () => {
    state.byCol = 1;
    expect(adapter.apply(sample)).toMatchObject({ ok: true, notes: [expect.stringContaining("By column is on")] });
    state.byCol = null;
  });
});
