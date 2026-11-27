// OG20: a result saved from a tool that read a row range is SAVED, recording the window it read (it used to be
// refused, #1127). Through the real store: the real "Use as row range" gesture, the real publish and commit
// entry points, and the real `.dwk` save and load.
import { beforeEach, describe, expect, it } from "vitest";

import { analysisDataFingerprint, snapshotResultState } from "../lib/analysisResultFreshness";
import { ROW_RANGE_PARAM, readOutputRowRanges, savedInputRowsLine } from "../lib/inputRowRange";
import { INPUT_ROW_RANGE_KEY } from "../lib/rowSidecars";
import { distributionQuestion } from "../lib/snapshotResultKey";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useAnalysisSelection } from "./analysisSelection";
import { commitComputedOutput } from "./commitComputedOutput";
import { publishDistributionResult } from "./distributionResults";
import { openWorksheetRowRange } from "./worksheetAnalysisHandoff";
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
const results = () => useApp.getState().analysisResults;
const clearRange = () => useAnalysisSelection.getState().updateItem("d1", { rowRange: null });
const version = (text: string): number => (JSON.parse(text) as { version: number }).version;

const commit = (id: string, settings: Record<string, unknown> = { a: 1 }) => commitComputedOutput({
  producer: { id, label: id, version: 1 }, sources: [{ id: "d1", computedOn: analysisDataFingerprint(useApp.getState().datasets[0]!) }],
  settings, name: "out", data: { time: [0], values: [[1]], labels: ["o"], units: [""], metadata: {} },
});

beforeEach(() => {
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({ datasets: [SHEET], activeId: "d1", analysisResults: [], history: [], future: [], status: "", staleDatasets: [] });
});

describe("a snapshot result under a row range", () => {
  it("saves, recording the window in SOURCE rows and the sheet row count", () => {
    expect(distributionQuestion(recipe)).toBeTruthy();
    openWorksheetRowRange("d1", [1, 2, 3]);
    expect(publishDistributionResult(SHEET, recipe, snapshot)).not.toBeNull();
    expect(results()).toHaveLength(1);
    expect(results()[0]!.parameters?.[ROW_RANGE_PARAM]).toEqual({ from: 1, to: 3, rows: 6 });
    expect(savedInputRowsLine(results()[0]!.parameters)).toBe("rows 2-4 of 6 (when saved)");
  });

  it("a ranged and an unranged save of one recipe are two results; the same ranged save twice is a duplicate", () => {
    openWorksheetRowRange("d1", [1, 2, 3]);
    expect(publishDistributionResult(SHEET, recipe, snapshot)).not.toBeNull();
    expect(publishDistributionResult(SHEET, recipe, snapshot)).toBeNull();
    expect(useApp.getState().status).toMatch(/already saved/);
    clearRange();
    expect(publishDistributionResult(SHEET, recipe, snapshot)).not.toBeNull(); // unranged: a new result
    expect(results()).toHaveLength(2);
    expect(results()[1]!.parameters).not.toHaveProperty(ROW_RANGE_PARAM);
    expect(publishDistributionResult(SHEET, recipe, snapshot)).toBeNull(); // the unranged one is a duplicate too
    openWorksheetRowRange("d1", [2, 3, 4]);
    expect(publishDistributionResult(SHEET, recipe, snapshot)).not.toBeNull(); // another window: another result
    expect(results()).toHaveLength(3);
  });

  it("is one undo step, and Undo then Save works again", () => {
    openWorksheetRowRange("d1", [1, 2, 3]);
    publishDistributionResult(SHEET, recipe, snapshot);
    useApp.getState().undo();
    expect(results()).toHaveLength(0);
    expect(publishDistributionResult(SHEET, recipe, snapshot)).not.toBeNull();
  });

  it("a range whose rows are gone is still refused, never recorded", () => {
    openWorksheetRowRange("d1", [4, 5]);
    useAnalysisSelection.getState().updateItem("d1", { rowRange: { from: 4, to: 3, was: "rows 5-6" } });
    expect(publishDistributionResult(SHEET, recipe, snapshot)).toBeNull();
    expect(useApp.getState().status).toMatch(/rows 5-6 no longer exist.*nothing was saved/);
    useAnalysisSelection.getState().updateItem("d1", { rowRange: { from: 4, to: 9 } }); // past the end
    expect(publishDistributionResult(SHEET, recipe, snapshot)).toBeNull();
    expect(useApp.getState().status).toMatch(/beyond the worksheet.*nothing was saved/);
    expect(results()).toHaveLength(0);
  });

  it("the record is history: new source rows mark the result out of date and the window stays as written", () => {
    openWorksheetRowRange("d1", [1, 2, 3]);
    publishDistributionResult(SHEET, recipe, snapshot);
    const grown: Dataset = { ...SHEET, data: { ...SHEET.data, time: [...SHEET.data.time, 6], values: [...SHEET.data.values, [7]] } };
    useApp.setState({ datasets: [grown] });
    expect(snapshotResultState(results()[0]!, useApp.getState().datasets, results())).not.toBe("current");
    expect(results()[0]!.parameters?.[ROW_RANGE_PARAM]).toEqual({ from: 1, to: 3, rows: 6 });
    expect(savedInputRowsLine(results()[0]!.parameters)).toContain("of 6"); // not "of 7": nothing presents it as live
  });
});

describe("a committed output worksheet under a row range", () => {
  it("is committed, and the OUTPUT records the window in its private metadata key", () => {
    openWorksheetRowRange("d1", [1, 2, 3]);
    const out = commit("tabulate");
    expect(out).toMatchObject({ kind: "created" });
    const output = useApp.getState().datasets.find((d) => d.id !== "d1")!;
    expect(output.data.metadata[INPUT_ROW_RANGE_KEY]).toEqual([{ datasetId: "d1", from: 1, to: 3, rows: 6 }]);
    expect(readOutputRowRanges(output.data.metadata)).toHaveLength(1);
    expect(savedInputRowsLine(undefined, output.data.metadata)).toBe("rows 2-4 of 6 (when saved)");
  });

  it("a ranged and an unranged commit of the same settings are two outputs; the same ranged commit twice is one", () => {
    openWorksheetRowRange("d1", [1, 2, 3]);
    expect(commit("tabulate")).toMatchObject({ kind: "created" });
    expect(commit("tabulate")).toMatchObject({ kind: "existing" });
    clearRange();
    expect(commit("tabulate")).toMatchObject({ kind: "created" });
    expect(commit("tabulate")).toMatchObject({ kind: "existing" });
    const outputs = useApp.getState().datasets.filter((d) => d.id !== "d1");
    expect(outputs).toHaveLength(2);
    expect(INPUT_ROW_RANGE_KEY in outputs[1]!.data.metadata).toBe(false); // the unranged output records nothing
  });

  it("a tool that does not read a range records none and commits as it always did", () => {
    openWorksheetRowRange("d1", [1, 2, 3]);
    expect(commit("signal-processing")).toMatchObject({ kind: "created" });
    expect(INPUT_ROW_RANGE_KEY in useApp.getState().datasets.at(-1)!.data.metadata).toBe(false);
  });

  it("a range that runs past the sheet is refused with the reason", () => {
    openWorksheetRowRange("d1", [1, 2, 3]);
    useAnalysisSelection.getState().updateItem("d1", { rowRange: { from: 4, to: 9 } });
    expect(commit("tabulate")).toMatchObject({ kind: "refused" });
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});

describe("the .dwk round trip", () => {
  const stateOf = () => ({ datasets: useApp.getState().datasets, analysisResults: useApp.getState().analysisResults });

  it("a ranged snapshot result and a ranged output save as v9 and reopen with their window", () => {
    openWorksheetRowRange("d1", [1, 2, 3]);
    publishDistributionResult(SHEET, recipe, snapshot);
    commit("tabulate");
    const text = serializeWorkspace(stateOf());
    expect(version(text)).toBe(9);
    useApp.setState({ datasets: [], analysisResults: [] });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    const loaded = useApp.getState();
    const snap = loaded.analysisResults.find((r) => r.producer.id === "distribution-analysis")!;
    expect(snap.parameters?.[ROW_RANGE_PARAM]).toEqual({ from: 1, to: 3, rows: 6 });
    const output = loaded.datasets.find((d) => d.id !== "d1")!;
    expect(readOutputRowRanges(output.data.metadata)).toEqual([{ datasetId: "d1", from: 1, to: 3, rows: 6 }]);
    expect(version(serializeWorkspace({ datasets: loaded.datasets, analysisResults: loaded.analysisResults }))).toBe(9);
  });

  it("each record alone gates the file (the v0.45.0 reader accepts versions 1-8)", () => {
    openWorksheetRowRange("d1", [1, 2, 3]);
    publishDistributionResult(SHEET, recipe, snapshot);
    expect(version(serializeWorkspace({ datasets: [SHEET], analysisResults: results() }))).toBe(9);
    useApp.setState({ analysisResults: [] });
    commit("tabulate");
    expect(version(serializeWorkspace({ datasets: useApp.getState().datasets, analysisResults: results() }))).toBe(9);
  });

  it("a project holding only unranged results still writes the lower version", () => {
    publishDistributionResult(SHEET, recipe, snapshot);
    commit("tabulate");
    expect(version(serializeWorkspace(stateOf()))).toBeLessThan(9);
  });
});
