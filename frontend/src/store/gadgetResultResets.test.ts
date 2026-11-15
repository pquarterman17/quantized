// The ROI gadget's quick-fit result carries two companions -- the model it was
// fitted with and the curve (Y, X) it was fitted on. Every reset that drops
// `qfitResult` must drop them too: a stale `qfitResultCurve` on a fresh
// dataset would bind the next result's overlay to the old dataset's channels.
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
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
