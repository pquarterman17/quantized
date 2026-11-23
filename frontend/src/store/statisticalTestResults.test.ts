// A repeat Run of the same statistical question on the same data saves nothing new
// (result-lifecycle criterion 11); a changed question or changed data is a new result.
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PARAMS, DEFAULT_SELECTION } from "../lib/statsTests";
import type { Dataset } from "../lib/types";
import { publishStatisticalTestResult } from "./statisticalTestResults";
import { useApp } from "./useApp";

const source = (v: number): Dataset => ({
  id: "s", name: "m.csv", data: { time: [0, 1], values: [[1, 2], [3, v]], labels: ["A", "B"], units: ["V", "A"], metadata: {} },
});
const output = (d: number) => ({ sentence: "No difference.", tables: [{ columns: ["statistic", "value"], rows: [["D", d] as (string | number)[]] }] });
const sel = { ...DEFAULT_SELECTION, x: 0, y: 1 };
const run = (ds: Dataset, d = 0.2, s = sel) => publishStatisticalTestResult(ds, "ks-two-sample", s, DEFAULT_PARAMS, ["A", "B"], output(d));

beforeEach(() => {
  useApp.setState({ datasets: [source(4)], analysisResults: [], history: [], future: [] });
});

describe("publishStatisticalTestResult", () => {
  it("a repeat of the identical run returns the saved result, with no duplicate and no extra undo step", () => {
    const first = run(source(4));
    expect(run(source(4))).toBe(first);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().status).toMatch(/already saved/);
  });

  it("changed data, a changed question or different tables save a new result", () => {
    run(source(4));
    run(source(5));
    run(source(4), 0.2, { ...sel, y: 0 });
    run(source(4), 0.9);
    expect(useApp.getState().analysisResults).toHaveLength(4);
  });
});
