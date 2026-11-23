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
import { INPUTS_PARAM, type InputX } from "../lib/resultInputsRecord";
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

type Writer = { name: string; commit: (computedOn: string, xKey?: InputX) => { kind: string } };
const withX = (xKey?: InputX) => (xKey === undefined ? {} : { xKey });
const WRITERS: Writer[] = [
  { name: "commitAnalysisOutput", commit: (computedOn, xKey) => commitAnalysisOutput({
    producer: PRODUCER, sourceId: "src", computedOn, settings: { k: 1 }, output: () => ({ name: "out", data: OUT }), ...withX(xKey) }) },
  { name: "commitComputedOutput", commit: (computedOn, xKey) => commitComputedOutput({
    producer: PRODUCER, sources: [{ id: "src", computedOn }], settings: { k: 1 }, name: "out", data: OUT, ...withX(xKey) }) },
  { name: "commitBatchTable", commit: (computedOn, xKey) => commitBatchTable({
    producer: PRODUCER, sources: [{ id: "src", computedOn }], settings: { k: 1 }, name: "out", data: OUT, ...withX(xKey) }) },
  { name: "commitBatchOutputs", commit: (computedOn, xKey) => {
    const report = commitBatchOutputs("Probe batch", [{ name: "out", request: {
      producer: PRODUCER, sourceId: "src", computedOn, settings: { k: 1 }, output: () => ({ name: "out", data: OUT }), ...withX(xKey) } }]);
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

  const recordedItem = () => (useApp.getState().analysisResults[0]!.parameters?.[INPUTS_PARAM] as { items: Record<string, unknown>[] }).items[0]!;

  it("criterion 9: an X channel the tool read is the recorded range (not the time axis)", () => {
    commit(computedOn(), 0); // the Moment channel [1,2,3,(4 excluded)]
    expect(recordedItem()).toMatchObject({ xLabel: "Moment", xUnit: "emu", includedRows: 3, xRange: [1, 3] });
  });

  it("criterion 9 (fail closed): no declared X, or an X that is not a column, records no range", () => {
    commit(computedOn());
    expect(recordedItem()).toMatchObject({ xLabel: null, xUnit: null, xRange: null });
    useApp.setState({ analysisResults: [], datasets: [SRC()] });
    commit(computedOn(), 7);
    expect(recordedItem()).toMatchObject({ xRange: null });
  });

  it("criterion 9: records the algorithm version, parameters, channels + units, included rows and X range", () => {
    commit(computedOn(), null);
    const [result] = useApp.getState().analysisResults;
    expect(result!.producer).toEqual(PRODUCER);
    expect(Number.isInteger(result!.producer.version)).toBe(true);
    expect((result!.parameters?.["settings"] as Record<string, unknown>)["k"]).toBe(1);
    expect(result!.sourceFingerprint).toBeTruthy();
    expect(result!.parameters?.[INPUTS_PARAM]).toEqual({ total: 1, items: [{
      datasetId: "src", name: "Film", channelCount: 1, channels: [{ index: 0, label: "Moment", unit: "emu" }],
      xLabel: "Field", xUnit: "Oe", rows: 4, includedRows: 3, xRange: [0, 20],
    }] });
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

describe("commitComputedOutput keeps a per-source X aligned with its sources (acceptance C9)", () => {
  const sheet = (id: string, xs: number[], second: number[]): Dataset => ({
    id, name: id, data: { time: xs.map((_, i) => i), values: xs.map((x, i) => [x, second[i]!]), labels: ["P", "Q"], units: ["a", "b"], metadata: {} },
  });
  const items = () => (useApp.getState().analysisResults[0]!.parameters?.[INPUTS_PARAM] as { items: { datasetId: string; xLabel: string | null }[] }).items;
  beforeEach(() => {
    useApp.setState({ datasets: [sheet("one", [1, 2], [5, 6]), sheet("two", [3, 4], [7, 8])], analysisResults: [], history: [], future: [], staleDatasets: [] });
  });
  const run = (xKey: InputX[] | Record<string, InputX>) => {
    const fp = (id: string) => analysisDataFingerprint(useApp.getState().datasets.find((d) => d.id === id)!);
    return commitComputedOutput({
      producer: PRODUCER, sources: [{ id: "one", computedOn: fp("one") }, { id: "one", computedOn: fp("one") }, { id: "two", computedOn: fp("two") }],
      settings: { k: 1 }, name: "out", data: OUT, xKey,
    });
  };

  it("a list follows its source through the duplicate drop", () => {
    // sources one, one, two: the second `one` is dropped, so `two` is the SECOND recorded input and takes the THIRD X.
    run([0, 0, 1]);
    expect(items()).toMatchObject([{ datasetId: "one", xLabel: "P" }, { datasetId: "two", xLabel: "Q" }]);
  });

  it("a map by dataset id is unaffected by the duplicate drop", () => {
    run({ two: 1, one: 0 });
    expect(items()).toMatchObject([{ datasetId: "one", xLabel: "P" }, { datasetId: "two", xLabel: "Q" }]);
  });

  it("the X never enters the commit key: the same run with another X is the same output", () => {
    run({ one: 0, two: 0 });
    expect(run({ one: 1, two: 1 }).kind).toBe("existing");
  });
});
