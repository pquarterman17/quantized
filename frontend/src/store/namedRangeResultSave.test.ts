// A result saved through a NAMED range records the range's id and name beside the rows it read, so a later move of the
// range marks it out of date (ROW_RANGE_CONTRACT 5.2). Through the real entry points: the analysis input's "from named
// range", the real snapshot publish and output commit, the real undo and the real `.dwk` save and load.
import { beforeEach, describe, expect, it } from "vitest";

import { analysisDataFingerprint, snapshotResultState } from "../lib/analysisResultFreshness";
import { ROW_RANGE_PARAM, readOutputRowRanges } from "../lib/inputRowRange";
import { rangeChangeNotes } from "../lib/namedRangeResultFreshness";
import { planRecordedRanges, recordedRowsCurrent } from "../lib/recordedRangeNav";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useAnalysisSelection } from "./analysisSelection";
import { commitComputedOutput } from "./commitComputedOutput";
import { publishDistributionResult } from "./distributionResults";
import { analysisInputFromNamedRange } from "./namedRangeUse";
import { defineNamedRange, retargetNamedRange } from "./namedRanges";
import { resetRangeLinkSyncForTests } from "./rangeLinkSync";
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
const st = () => useApp.getState();
const result = () => st().analysisResults.find((r) => r.producer.id === "distribution-analysis")!;
const retarget = (rows: { from: number; to: number } | null) => expect(retargetNamedRange(rangeId, { datasetId: "d1", cols: [0], rows })).toMatchObject({ ok: true });
let rangeId = "";

const commit = () => commitComputedOutput({
  producer: { id: "tabulate", label: "tabulate", version: 1 }, sources: [{ id: "d1", computedOn: analysisDataFingerprint(st().datasets[0]!) }],
  settings: { a: 1 }, name: "out", data: { time: [0], values: [[1]], labels: ["o"], units: [""], metadata: {} },
});

beforeEach(() => {
  resetRangeLinkSyncForTests();
  useAnalysisSelection.setState({ toolId: null, selection: null, offeredRanges: {} });
  useApp.setState({ datasets: [SHEET], workbooks: [], activeId: "d1", namedRanges: [], analysisResults: [], history: [], future: [], status: "", staleDatasets: [] });
  const made = defineNamedRange({ name: "Base", scope: "sheet", datasetId: "d1", cols: [0], rows: { from: 1, to: 3 } });
  rangeId = made.ok ? made.id : "";
  expect(analysisInputFromNamedRange(rangeId, "distribution")).toEqual({ ok: true });
});

describe("a snapshot result saved through named range Base", () => {
  it("records the rows, the name AND the range's id", () => {
    expect(publishDistributionResult(SHEET, recipe, snapshot)).not.toBeNull();
    expect(result().parameters?.[ROW_RANGE_PARAM]).toEqual({ from: 1, to: 3, rows: 6, name: "Base", rangeId });
    expect(snapshotResultState(result(), st().datasets)).toBe("current");
  });

  it("goes out of date when Base is retargeted, and is current again after the one Undo", () => {
    publishDistributionResult(SHEET, recipe, snapshot);
    retarget({ from: 2, to: 4 });
    expect(snapshotResultState(result(), st().datasets)).toBe("out-of-date");
    expect(rangeChangeNotes(result(), st().datasets)).toEqual([
      "Out of date: range Base changed since this result was saved (it read rows 2-4; now rows 3-5). Reopen in tool to run it on the range's current rows.",
    ]);
    st().undo();
    expect(snapshotResultState(result(), st().datasets)).toBe("current");
  });

  it("a range edited back to the rows it read leaves the result current", () => {
    publishDistributionResult(SHEET, recipe, snapshot);
    retarget({ from: 0, to: 5 });
    expect(snapshotResultState(result(), st().datasets)).toBe("out-of-date");
    retarget({ from: 1, to: 3 });
    expect(snapshotResultState(result(), st().datasets)).toBe("current");
  });

  it("a rename does not matter (the id is what it follows), a retarget after it still does", () => {
    publishDistributionResult(SHEET, recipe, snapshot);
    const ranges = st().namedRanges.map((r) => ({ ...r, name: "Renamed" }));
    useApp.setState({ namedRanges: ranges });
    expect(snapshotResultState(result(), st().datasets)).toBe("current");
    retarget({ from: 2, to: 4 });
    expect(rangeChangeNotes(result(), st().datasets)[0]).toContain("range Renamed changed");
  });

  it("survives the .dwk: the id is kept, and a range moved while the file was closed marks the result out of date", () => {
    publishDistributionResult(SHEET, recipe, snapshot);
    const text = serializeWorkspace({ ...st() });
    expect((JSON.parse(text) as { version: number }).version).toBe(9); // parameters.rowRange is already a gated key
    const doc = JSON.parse(text) as { namedRanges: { id: string; target: { rows: { from: number; to: number } } }[] };
    doc.namedRanges[0]!.target.rows = { from: 2, to: 4 }; // retargeted by another session
    useApp.setState({ datasets: [], analysisResults: [], namedRanges: [] });
    st().loadWorkspace(parseWorkspace(JSON.stringify(doc)));
    expect(result().parameters?.[ROW_RANGE_PARAM]).toEqual({ from: 1, to: 3, rows: 6, name: "Base", rangeId });
    expect(snapshotResultState(result(), st().datasets)).toBe("out-of-date");
  });
});

describe("a committed output saved through named range Base", () => {
  it("records the id on the output's metadata, goes out of date with the range, and Go to Source is refused while it is", () => {
    expect(commit()).toMatchObject({ kind: "created" });
    const output = st().datasets.find((d) => d.id !== "d1")!;
    expect(readOutputRowRanges(output.data.metadata)).toEqual([{ datasetId: "d1", from: 1, to: 3, rows: 6, name: "Base", rangeId }]);
    const saved = st().analysisResults[0]!;
    expect(rangeChangeNotes(saved, st().datasets)).toEqual([]);
    expect(recordedRowsCurrent(saved, st().datasets)).toBe(true);
    retarget({ from: 2, to: 4 });
    expect(rangeChangeNotes(saved, st().datasets)).toHaveLength(1);
    expect(recordedRowsCurrent(saved, st().datasets)).toBe(false);
    const plan = planRecordedRanges(saved, output.data.metadata, st().datasets)[0]!;
    expect(plan.ok).toBe(false);
    // Reopen in tool asks for the live link instead: the range as it is now.
    const live = planRecordedRanges(saved, output.data.metadata, st().datasets, true)[0]!;
    expect(live).toMatchObject({ ok: true, link: { from: 2, to: 4, named: rangeId, namedAs: "Base" } });
  });
});
