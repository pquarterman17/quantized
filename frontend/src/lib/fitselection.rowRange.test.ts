// R1 of ROW_RANGE_CONTRACT: a fit on a row range goes through the `explicit`
// path, so the recipe records the exact rows (FitSpec.rowIds + fingerprints);
// replay uses those rows, never the live range, and refuses after a sort.
import { beforeEach, describe, expect, it } from "vitest";

import { fitSpecFrom } from "./fitselectionActions";
import { fitDataForSpec, resolveFitInputs, selectedFitData } from "./fitselection";
import type { AnalysisSelectionItem } from "./analysisSelection";
import type { CalcResult, Dataset } from "./types";
import { sortWorksheetRows } from "../store/sortRows";
import { useApp } from "../store/useApp";

const n = 12;
const sheet = (): Dataset => ({
  id: "d",
  name: "run.csv",
  data: {
    time: Array.from({ length: n }, (_v, i) => i),
    values: Array.from({ length: n }, (_v, i) => [(i * 5) % n, i * 2]),
    labels: ["T", "R"], units: ["", ""], metadata: {},
  },
  excludedRows: [4],
  columnDesignations: ["Y", "Y"],
});
const item = (over: Partial<AnalysisSelectionItem>): AnalysisSelectionItem => ({
  datasetId: "d", xKey: null, yKeys: [1], errorBindings: [], errorKeys: {}, factorKeys: [], rowIds: null, range: null, roi: null, ...over,
});
const result = { params: [1, 0], errors: [0, 0] } as unknown as CalcResult;

beforeEach(() => {
  useApp.setState({ datasets: [sheet()], activeId: "d", history: [], future: [], status: "" });
});

describe("a fit on a row range", () => {
  it("is explicit: it reads the window through the resolver and records the source rows", () => {
    const ds = sheet();
    const fit = selectedFitData(ds, null, [1], null, item({ rowRange: { from: 2, to: 7 } }))!;
    expect(fit.sourceRows).toEqual([2, 3, 5, 6, 7]); // row 4 is excluded, inside the window
    expect(fit.x).toEqual([2, 3, 5, 6, 7]);
    expect(fit.y).toEqual([4, 6, 10, 12, 14]);
    expect(fit.analysisRows).toEqual([2, 3, 4, 5, 6]); // positions in the analysis view
    const spec = fitSpecFrom("Linear", null, fit, result);
    expect(spec.rowIds).toEqual([2, 3, 5, 6, 7]);
    expect(spec.sourceRowCount).toBe(n);
    expect(spec.rowXFingerprint).toBeDefined();
  });

  it("replays from the recorded rows, not the live range", () => {
    const ds = sheet();
    const spec = fitSpecFrom("Linear", null, selectedFitData(ds, null, [1], null, item({ rowRange: { from: 2, to: 7 } }))!, result);
    const again = fitDataForSpec(ds, spec, null, null, null);
    expect(again?.sourceRows).toEqual([2, 3, 5, 6, 7]);
  });

  it("refuses to replay after a sort (the saved subset no longer matches)", () => {
    const spec = fitSpecFrom("Linear", null, selectedFitData(sheet(), null, [1], null, item({ rowRange: { from: 2, to: 7 } }))!, result);
    sortWorksheetRows("d", 0, 1);
    const sorted = useApp.getState().datasets[0];
    expect(spec.rowIds).toBeDefined(); // callers throw FIT_SUBSET_MISMATCH for exactly this pair
    expect(fitDataForSpec(sorted, spec, null, null, null)).toBeNull();
  });

  it("a range past the end, or one whose rows were deleted, refuses with the reason", () => {
    const past = resolveFitInputs(sheet(), null, [1], null, item({ rowRange: { from: 8, to: 20 } }));
    expect(!past.ok && past.reason).toBe("rows 9-21 is beyond the worksheet's 12 rows");
    const gone = resolveFitInputs(sheet(), null, [1], null, item({ rowRange: { from: 3, to: 2, was: "rows 4-6" } }));
    expect(!gone.ok && gone.reason).toBe("rows 4-6 no longer exist");
  });

  it("without a range the fit is not explicit (unchanged behaviour)", () => {
    const fit = selectedFitData(sheet(), null, [1], null, item({}))!;
    expect(fit.sourceRows).toBeUndefined();
  });
});
