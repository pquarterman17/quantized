// The ROI gadget's quick-fit result carries two companions -- the model it was
// fitted with and the curve (Y, X) it was fitted on. Every reset that drops
// `qfitResult` must drop them too: a stale `qfitResultCurve` on a fresh
// dataset would bind the next result's overlay to the old dataset's channels.
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import { QFIT_RESULT_RESET } from "./qfitResultReset";
import { analysisResultReset } from "./windowFocus";
import { useApp } from "./useApp";

const ds: Dataset = {
  id: "d1",
  name: "d1.csv",
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["Y"], units: [""], metadata: {} },
};
const STALE = {
  qfitResult: { params: [1, 2] } as never,
  qfitResultModel: "Linear",
  qfitResultCurve: { yKey: 0, xKey: null },
};

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [ds], activeId: "d1", ...STALE });
});

describe("quick-fit result resets", () => {
  it("analysisResultReset clears the model and curve with the result", () => {
    expect(analysisResultReset()).toMatchObject({ qfitResult: null, qfitResultModel: null, qfitResultCurve: null });
  });

  it("duplicating a dataset starts the clone without the old quick-fit result", async () => {
    await useApp.getState().duplicateDataset("d1");
    const s = useApp.getState();
    expect(s.datasets).toHaveLength(2);
    expect(s.qfitResult).toBeNull();
    expect(s.qfitResultModel).toBeNull();
    expect(s.qfitResultCurve).toBeNull();
  });
});

describe("QFIT_RESULT_RESET is the one list", () => {
  it("covers every qfitResult* field of the store", () => {
    const fields = Object.keys(useApp.getInitialState()).filter((k) => k.startsWith("qfitResult")).sort();
    expect(fields).toEqual(Object.keys(QFIT_RESULT_RESET).sort());
  });

  it("every one of those fields is cleared by a focus-change reset and by a dataset clone", async () => {
    const keys = Object.keys(QFIT_RESULT_RESET);
    const reset = analysisResultReset();
    for (const k of keys) expect(reset).toHaveProperty(k, null);
    await useApp.getState().duplicateDataset("d1");
    for (const k of keys) expect((useApp.getState() as unknown as Record<string, unknown>)[k]).toBeNull();
  });
});
