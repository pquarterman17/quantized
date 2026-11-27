// A result saved from a tool that narrowed to a row range cannot name its rows
// (naming them is a persisted key, gated by contract R0), so the save fails
// closed with the reason, and works again once the range is cleared.
import { beforeEach, describe, expect, it } from "vitest";

import { distributionQuestion } from "../lib/snapshotResultKey";
import type { Dataset } from "../lib/types";
import { useAnalysisSelection } from "./analysisSelection";
import { commitComputedOutput } from "./commitComputedOutput";
import { publishDistributionResult } from "./distributionResults";
import { openWorksheetRowRange } from "./worksheetAnalysisHandoff";
import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { useApp } from "./useApp";

const SHEET: Dataset = {
  id: "d1", name: "run.csv",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[1], [2], [3], [4], [5], [6]], labels: ["v"], units: [""], metadata: {} },
};
const recipe = { col: 0, byCol: null, fitDist: "none", compareOpen: false, percentileInput: 90 } as const;
const snapshot = {
  label: "v", byLabel: null, hist: null, desc: null, norm: null, normNote: null, levels: [], rankedFits: [],
  rankingMetric: "aicc", quantiles: null, percentileValue: null, skipped: [], totalLevelCount: 0,
} as never;

beforeEach(() => {
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({ datasets: [SHEET], activeId: "d1", analysisResults: [], history: [], future: [], status: "" });
});

describe("saving under a row range fails closed", () => {
  it("a snapshot result is refused with the range named, then saves once the range is cleared", () => {
    expect(distributionQuestion(recipe)).toBeTruthy();
    openWorksheetRowRange("d1", [1, 2, 3]);
    expect(publishDistributionResult(SHEET, recipe, snapshot)).toBeNull();
    expect(useApp.getState().status).toMatch(/rows 2-4 only.*nothing was saved/);
    expect(useApp.getState().analysisResults).toHaveLength(0);
    useAnalysisSelection.getState().updateItem("d1", { rowRange: null });
    expect(publishDistributionResult(SHEET, recipe, snapshot)).not.toBeNull();
  });

  it("a committed output is refused for a tool that reads the range, not for one that does not", () => {
    openWorksheetRowRange("d1", [1, 2, 3]);
    const commit = (id: string) => commitComputedOutput({
      producer: { id, label: id, version: 1 }, sources: [{ id: "d1", computedOn: analysisDataFingerprint(SHEET) }],
      settings: { a: 1 }, name: "out", data: { time: [0], values: [[1]], labels: ["o"], units: [""], metadata: {} },
    });
    expect(commit("tabulate")).toMatchObject({ kind: "refused" });
    expect(commit("signal-processing")).toMatchObject({ kind: "created" });
  });
});
