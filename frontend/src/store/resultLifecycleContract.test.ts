// Result-lifecycle acceptance contract (plans/RESULT_ACCEPTANCE_AUDIT.md),
// table-driven over every shared "add an analysis output" entry point so a
// future writer registered here cannot skip the criteria:
//   8  raw data is never overwritten; the commit adds a linked derived worksheet;
//   9  the input dataset, channels + units, included rows, X range, parameters and
//      algorithm (producer) version are recorded;
//   11 a commit is ONE undo step and a repeat click creates nothing;
//   13 a changed input marks the result stale (manual mode), nothing in off mode.
import { beforeEach, describe, expect, it } from "vitest";

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { INPUTS_PARAM } from "../lib/resultInputsRecord";
import type { Dataset, DataStruct } from "../lib/types";
import { addDatasetsOneStep } from "./addDatasetsOneStep";
import { commitAnalysisOutput } from "./analysisOutputCommit";
import { commitBatchOutputs } from "./commitBatchOutputs";
import { commitBatchTable } from "./commitBatchTable";
import { commitComputedOutput } from "./commitComputedOutput";
import { useApp } from "./useApp";

const table = (ys: number[]): DataStruct => ({
  time: ys.map((_, i) => i * 10), values: ys.map((v) => [v]), labels: ["Moment"], units: ["emu"],
  metadata: { x_column_name: "Field", x_column_unit: "Oe" },
});
const SRC = (): Dataset => ({ id: "src", name: "Film", data: table([1, 2, 3, 4]), excludedRows: [3] });
const PRODUCER = { id: "contract-probe", label: "Contract probe", version: 3 };
const OUT = table([9, 9, 9]);

type Writer = { name: string; commit: (computedOn: string) => { kind: string } };
const WRITERS: Writer[] = [
  { name: "commitAnalysisOutput", commit: (computedOn) => commitAnalysisOutput({
    producer: PRODUCER, sourceId: "src", computedOn, settings: { k: 1 }, output: () => ({ name: "out", data: OUT }) }) },
  { name: "commitComputedOutput", commit: (computedOn) => commitComputedOutput({
    producer: PRODUCER, sources: [{ id: "src", computedOn }], settings: { k: 1 }, name: "out", data: OUT }) },
  { name: "commitBatchTable", commit: (computedOn) => commitBatchTable({
    producer: PRODUCER, sources: [{ id: "src", computedOn }], settings: { k: 1 }, name: "out", data: OUT }) },
  { name: "commitBatchOutputs", commit: (computedOn) => {
    const report = commitBatchOutputs("Probe batch", [{ name: "out", request: {
      producer: PRODUCER, sourceId: "src", computedOn, settings: { k: 1 }, output: () => ({ name: "out", data: OUT }) } }]);
    return { kind: report.refused.length ? "refused" : report.created ? "created" : "existing" };
  } },
];

const derived = () => useApp.getState().datasets.filter((d) => d.id !== "src");

beforeEach(() => {
  useApp.setState({
    datasets: [SRC()], activeId: "src", analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
});

describe.each(WRITERS)("$name", ({ commit }) => {
  const computedOn = () => analysisDataFingerprint(useApp.getState().datasets[0]!);

  it("criterion 8: leaves the raw source untouched and adds a linked derived worksheet", () => {
    const before = JSON.stringify(useApp.getState().datasets[0]);
    expect(commit(computedOn()).kind).toBe("created");
    expect(JSON.stringify(useApp.getState().datasets[0])).toBe(before);
    const [result] = useApp.getState().analysisResults;
    expect(derived()).toHaveLength(1);
    expect(result!.sources).toEqual([{ datasetId: "src", role: "input" }]);
    expect(result!.outputs).toEqual([{ datasetId: derived()[0]!.id, role: "linked-worksheet" }]);
  });

  it("criterion 9: records the algorithm version, parameters, channels + units, included rows and X range", () => {
    commit(computedOn());
    const [result] = useApp.getState().analysisResults;
    expect(result!.producer).toEqual(PRODUCER);
    expect(Number.isInteger(result!.producer.version)).toBe(true);
    expect((result!.parameters?.["settings"] as Record<string, unknown>)["k"]).toBe(1);
    expect(result!.sourceFingerprint).toBeTruthy();
    expect(result!.parameters?.[INPUTS_PARAM]).toEqual([{
      datasetId: "src", name: "Film", channels: [{ index: 0, label: "Moment", unit: "emu" }],
      xLabel: "Field", xUnit: "Oe", rows: 4, includedRows: 3, xRange: [0, 20],
    }]);
  });

  it("criterion 11: one undo step; a repeat commit creates nothing", () => {
    commit(computedOn());
    expect(useApp.getState().history).toHaveLength(1);
    expect(commit(computedOn()).kind).toBe("existing");
    expect(derived()).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(derived()).toHaveLength(0);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("criterion 11 (refusal): a commit computed on a changed source writes nothing", () => {
    const stale = computedOn();
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, data: table([7, 7, 7, 7]) })) }));
    expect(commit(stale).kind).toBe("refused");
    expect(derived()).toHaveLength(0);
  });

  it("criterion 13: a changed input marks the output stale in manual mode, nothing in off mode", () => {
    commit(computedOn());
    useApp.getState().touchDataset("src");
    expect(useApp.getState().staleDatasets).toEqual([derived()[0]!.id]);
    useApp.setState({ staleDatasets: [], recalcMode: "off" });
    useApp.getState().touchDataset("src");
    expect(useApp.getState().staleDatasets).toEqual([]);
  });
});

describe("addDatasetsOneStep", () => {
  it("adds every dataset as ONE undo step and undo removes them all", () => {
    const ids = addDatasetsOneStep("add curves", [
      { name: "a", data: table([1]) }, { name: "b", data: table([2]) }, { name: "c", data: table([3]) },
    ]);
    expect(ids).toHaveLength(3);
    expect(derived()).toHaveLength(3);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(derived()).toHaveLength(0);
  });

  it("an empty set adds nothing and records no history", () => {
    expect(addDatasetsOneStep("add curves", [])).toEqual([]);
    expect(useApp.getState().history).toHaveLength(0);
  });
});
