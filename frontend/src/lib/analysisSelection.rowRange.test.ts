// A row range on a selection item: batch reads (analysisSelectionData) honour it,
// resolveAnalysisSelection validates it, and the durable snapshot records the
// rows through the EXISTING `rowRuns` key (no new saved field in R1).
import { describe, expect, it } from "vitest";

import { analysisSelectionData, analysisSelectionSnapshot, resolveAnalysisSelection, type AnalysisSelectionItem } from "./analysisSelection";
import type { Dataset } from "./types";

const dataset: Dataset = {
  id: "d",
  name: "run.csv",
  data: {
    time: Array.from({ length: 30 }, (_v, i) => i),
    values: Array.from({ length: 30 }, (_v, i) => [i]),
    labels: ["v"], units: [""], metadata: {},
  },
  excludedRows: [12],
};
const item = (over: Partial<AnalysisSelectionItem>): AnalysisSelectionItem => ({
  datasetId: "d", xKey: null, yKeys: [0], errorBindings: [], errorKeys: {}, factorKeys: [], rowIds: null, range: null, roi: null, ...over,
});

describe("row range on a selection item", () => {
  it("analysisSelectionData reads the window from the analysis view", () => {
    expect(analysisSelectionData(dataset, item({ rowRange: { from: 10, to: 14 } })).time).toEqual([10, 11, 13, 14]);
  });

  it("resolveAnalysisSelection refuses a range past the end and counts the window", () => {
    const ok = resolveAnalysisSelection({ version: 1, source: "worksheet", createdAt: "t", items: [item({ rowRange: { from: 10, to: 14 } })] }, [dataset]);
    expect(ok.items[0].rowCount).toBe(4);
    const past = resolveAnalysisSelection({ version: 1, source: "worksheet", createdAt: "t", items: [item({ rowRange: { from: 25, to: 40 } })] }, [dataset]);
    expect(past.items).toHaveLength(0);
    expect(past.issues[0].message).toBe("rows 26-41 is beyond the worksheet's 30 rows");
  });

  it("the snapshot writes the window as rowRuns and saves no rowRange key", () => {
    const window = analysisSelectionSnapshot({ version: 1, source: "worksheet", createdAt: "t", items: [item({ rowRange: { from: 10, to: 14 } })] });
    expect(window.items[0].rowRuns).toBe("10-14");
    expect("rowRange" in window.items[0]).toBe(false);
    const picked = analysisSelectionSnapshot({ version: 1, source: "worksheet", createdAt: "t", items: [item({ rowRange: { from: 10, to: 14 }, rowIds: [3, 11, 12, 20] })] });
    expect(picked.items[0].rowRuns).toBe("11-12");
    const none = analysisSelectionSnapshot({ version: 1, source: "worksheet", createdAt: "t", items: [item({})] });
    expect(none.items[0].rowRuns).toBeNull();
  });
});
