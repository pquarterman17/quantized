// Row-wise t-tests: the optional adjusted-p column. The request carries the
// choice, the result table and the committed worksheet gain one column next to
// the raw p (never instead of it), and saved records from before it restore.
import { describe, expect, it } from "vitest";

import type { StatsTestResult } from "./api/statsTests";
import type { RowTAdjust } from "./api/statsTestsRows";
import { P_ADJUSTED, rowTestWorksheet } from "./rowTestWorksheet";
import { DEFAULT_PARAMS, DEFAULT_SELECTION, buildTestRequest, type TestParams } from "./statsTests";
import { describeResult } from "./statsTestsResults";
import { DEFAULT_ROWT, restoreRowT, rowTSettings } from "./statsTestsRows";
import type { DataStruct } from "./types";

const data: DataStruct = {
  time: [1, 2], values: [[1, 2, 5, 6], [2, 3, 6, 8]], labels: ["a1", "a2", "b1", "b2"], units: ["", "", "", ""], metadata: {},
};
const params = (adjust: RowTAdjust): TestParams => ({ ...DEFAULT_PARAMS, rowt: { ...DEFAULT_ROWT, groupB: [2, 3], adjust } });
const sel = { ...DEFAULT_SELECTION, cols: [0, 1] };

const row = (i: number, p: number | null, adj: number | null) => ({
  row: i, n1: 2, n2: 2, mean1: 1, mean2: 5, diff: -4, se: 1, t: -4, df: 2, p, p_adjusted: adj, ci_low: -8, ci_high: 0, status: p === null ? "too few values" : "ok",
});
const result = (adjust: RowTAdjust): StatsTestResult => ({
  id: "row-t-tests",
  data: {
    design: "two-sample", variance: "welch", mu: 0, alpha: 0.05, alternative: "two-sided", method: "Row-wise two-sample t-test (Welch)",
    n_rows: 3, n_tested: 2, adjust, rows: [row(0, 0.01, adjust === "none" ? null : 0.02), row(1, 0.04, adjust === "none" ? null : 0.08), row(2, null, null)],
  },
});

describe("row-wise p adjustment", () => {
  it("is off by default and sends the chosen method", () => {
    expect(DEFAULT_ROWT.adjust).toBe("none");
    expect(buildTestRequest("row-t-tests", data, sel, params("none"))).toMatchObject({ ok: true, request: { body: { adjust: "none" } } });
    expect(buildTestRequest("row-t-tests", data, sel, params("holm"))).toMatchObject({ ok: true, request: { body: { adjust: "holm" } } });
  });

  it("lists the adjustment in the settings only when one is chosen", () => {
    expect(rowTSettings(params("none")).map(([k]) => k)).not.toContain("P adjustment");
    expect(rowTSettings(params("bh"))).toEqual(expect.arrayContaining([["P adjustment", expect.stringContaining("Benjamini")]]));
  });

  it("adds the adjusted column after the raw p and keeps both", () => {
    const out = describeResult(result("holm"), ["a", "b"], 0.05);
    const cols = out.tables[0].columns;
    expect(cols[cols.indexOf("p") + 1]).toBe(P_ADJUSTED);
    const r1 = out.tables[0].rows[1];
    expect([r1[cols.indexOf("p")], r1[cols.indexOf(P_ADJUSTED)]]).toEqual([0.04, 0.08]);
    expect(out.sentence).toContain("Holm");
    expect(out.sentence).toContain("1 stays below 0.05 after the correction");
    expect(out.sentence).not.toContain("not adjusted");
  });

  it("adds no column and keeps the not-adjusted warning without it", () => {
    const out = describeResult(result("none"), ["a", "b"], 0.05);
    expect(out.tables[0].columns).not.toContain(P_ADJUSTED);
    expect(out.sentence).toContain("not adjusted");
  });

  it("commits the adjusted column in the worksheet, NaN for an untested row, source rows kept", () => {
    const r = result("bonferroni");
    if (r.id !== "row-t-tests") throw new Error("x");
    const ws = rowTestWorksheet(r.data, [10, 20, 30], "t", "s", [1, 4, 5]);
    const k = ws.labels.indexOf(P_ADJUSTED);
    expect(ws.labels[k - 1]).toBe("p");
    expect(ws.values.map((v) => v[k])).toEqual([0.02, 0.08, NaN]);
    expect(ws.values.map((v) => v[0])).toEqual([2, 5, 6]);
  });

  it("restores a record saved before the option existed as none, refuses a bad value", () => {
    const { adjust: _drop, ...old } = DEFAULT_ROWT;
    expect(restoreRowT(old)).toEqual(DEFAULT_ROWT);
    expect(restoreRowT({ ...DEFAULT_ROWT, adjust: "holm" })).toMatchObject({ adjust: "holm" });
    expect(restoreRowT({ ...DEFAULT_ROWT, adjust: "sidak" })).toBeNull();
  });
});
