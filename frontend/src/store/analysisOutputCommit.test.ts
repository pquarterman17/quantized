// The shared commit contract (lane RL): one undo step, idempotent repeat
// commits, fail-closed source checks, and stale-input marking through the
// existing recalc engine and save/load freshness stamp.
import { beforeEach, describe, expect, it } from "vitest";

import { analysisDataFingerprint, stampAnalysisResults } from "../lib/analysisResultFreshness";
import { staleAnalysisOutputs } from "../lib/analysisResultStaleLoad";
import { isCommittedOutputResult } from "../lib/committedOutputGraph";
import { toResultValue } from "../lib/committedOutput";
import type { Dataset, DataStruct } from "../lib/types";
import { commitAnalysisOutput, type AnalysisOutputCommit } from "./analysisOutputCommit";
import { useApp } from "./useApp";

const data = (values: number[]): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["y"], units: [""], metadata: {},
});
const SOURCE: Dataset = { id: "src", name: "Film", data: data([1, 2, 3]) };
const PRODUCER = { id: "surface-fit", label: "Surface fit", version: 1 };

function request(overrides: Partial<AnalysisOutputCommit> = {}): AnalysisOutputCommit {
  const source = useApp.getState().datasets.find((d) => d.id === "src")!;
  return {
    producer: PRODUCER,
    sourceId: "src",
    computedOn: analysisDataFingerprint(source),
    settings: { model: "Plane", params: [1, 2] },
    output: (s) => ({ name: `${s.name} (fit)`, data: data([9, 9, 9]) }),
    ...overrides,
  };
}

const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "src");

beforeEach(() => {
  useApp.setState({
    datasets: [SOURCE], activeId: "src", analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "manual",
  });
});

describe("commitAnalysisOutput", () => {
  it("adds the output worksheet and its Library result as ONE undo step", () => {
    const outcome = commitAnalysisOutput(request());
    expect(outcome.kind).toBe("created");
    expect(outputs()).toHaveLength(1);
    const [result] = useApp.getState().analysisResults;
    expect(isCommittedOutputResult(result)).toBe(true);
    expect(result.sources).toEqual([{ datasetId: "src", role: "input" }]);
    expect(result.outputs).toEqual([{ datasetId: outputs()[0].id, role: "linked-worksheet" }]);
    expect(result.parameters?.["settings"]).toEqual({ model: "Plane", params: [1, 2] });
    expect(useApp.getState().history).toHaveLength(1);

    useApp.getState().undo();
    expect(outputs()).toHaveLength(0);
    expect(useApp.getState().analysisResults).toHaveLength(0);
    useApp.getState().redo();
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
  });

  it("a repeat commit of the same computation creates nothing and shows the existing output", () => {
    const first = commitAnalysisOutput(request());
    useApp.setState({ activeId: "src" });
    const second = commitAnalysisOutput(request());
    expect(second.kind).toBe("existing");
    expect(second.kind !== "refused" && first.kind !== "refused" && second.outputId === first.outputId).toBe(true);
    expect(outputs()).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().activeId).toBe(outputs()[0].id);
  });

  it("commits again after Undo, and for a different result", () => {
    commitAnalysisOutput(request());
    useApp.getState().undo();
    expect(commitAnalysisOutput(request()).kind).toBe("created");
    expect(commitAnalysisOutput(request({ settings: { model: "Plane", params: [1, 3] } })).kind).toBe("created");
    expect(outputs()).toHaveLength(2);
  });

  it("fails closed on a changed, missing or still-loading source", () => {
    expect(commitAnalysisOutput(request({ computedOn: "older" })).kind).toBe("refused");
    useApp.setState({ datasets: [{ ...SOURCE, pending: { kind: "lazy" } as unknown as NonNullable<Dataset["pending"]> }] });
    expect(commitAnalysisOutput(request({ computedOn: "x" })).kind).toBe("refused");
    expect(commitAnalysisOutput(request({ sourceId: "gone" })).kind).toBe("refused");
    expect(useApp.getState().analysisResults).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("keeps the commit key through the envelope sanitizer's finite-number rule", () => {
    expect(toResultValue({ a: Number.NaN, b: [1, Infinity], c: undefined, d: "x" })).toEqual({ a: null, b: [1, null], d: "x" });
  });
});

describe("stale-input marking for a committed output", () => {
  const edit = () => {
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "src" ? { ...d, data: data([1, 2, 4]) } : d) }));
    useApp.getState().touchDataset("src");
  };

  it("manual mode marks the output stale when its source changes; a stale output no longer blocks a commit", () => {
    const first = commitAnalysisOutput(request());
    const outputId = first.kind === "created" ? first.outputId : "";
    const before = request();
    edit();
    expect(useApp.getState().staleDatasets).toEqual([outputId]);
    // The same (old) computation is now refused as changed, and a commit on
    // the current data is a new computation.
    expect(commitAnalysisOutput(before).kind).toBe("refused");
    expect(commitAnalysisOutput(request()).kind).toBe("created");
  });

  it("off mode tracks nothing", () => {
    useApp.setState({ recalcMode: "off" });
    commitAnalysisOutput(request());
    edit();
    expect(useApp.getState().staleDatasets).toEqual([]);
  });

  it("a recalculation pass leaves it stale (there is no recipe to replay)", async () => {
    const first = commitAnalysisOutput(request());
    const outputId = first.kind === "created" ? first.outputId : "";
    const outputData = outputs()[0].data;
    edit();
    await useApp.getState().recalcNow();
    expect(useApp.getState().staleDatasets).toEqual([outputId]);
    expect(outputs()[0].data).toBe(outputData);
  });

  it("the stale state survives save and reopen through the existing freshness stamp", () => {
    commitAnalysisOutput(request());
    const outputId = outputs()[0].id;
    // Saved while current: reopening against changed source data reads stale.
    const saved = stampAnalysisResults(useApp.getState().analysisResults, useApp.getState().datasets, []);
    expect(saved[0].stale).toBeUndefined();
    const changed = useApp.getState().datasets.map((d) => d.id === "src" ? { ...d, data: data([5, 5, 5]) } : d);
    expect(staleAnalysisOutputs(saved, changed)).toEqual([outputId]);
    // Saved while stale: it stays stale.
    edit();
    const savedStale = stampAnalysisResults(useApp.getState().analysisResults, useApp.getState().datasets, useApp.getState().staleDatasets);
    expect(savedStale[0].stale).toBe(true);
  });

  describe("multi-source outputs (alsoFrom)", () => {
    const SECOND: Dataset = { id: "src2", name: "Film 2", data: data([4, 5, 6]) };
    const multi = (): AnalysisOutputCommit => request({
      alsoFrom: [{ id: "src2", computedOn: analysisDataFingerprint(useApp.getState().datasets.find((d) => d.id === "src2")!) }],
    });
    beforeEach(() => useApp.setState({ datasets: [SOURCE, SECOND] }));

    it("lists every source, is idempotent, and any source going stale marks the output", () => {
      expect(commitAnalysisOutput(multi()).kind).toBe("created");
      expect(commitAnalysisOutput(multi()).kind).toBe("existing");
      const [result] = useApp.getState().analysisResults;
      expect(result.sources.map((s) => s.datasetId)).toEqual(["src", "src2"]);
      const outputId = result.outputs[0].datasetId;
      useApp.getState().touchDataset("src2");
      expect(useApp.getState().staleDatasets).toEqual([outputId]);
    });

    it("fails closed, writing nothing, when a further source changed since the computation", () => {
      const req = multi();
      useApp.setState({ datasets: [SOURCE, { ...SECOND, data: data([9, 9, 9]) }] });
      expect(commitAnalysisOutput(req).kind).toBe("refused");
      expect(useApp.getState().datasets).toHaveLength(2);
      expect(useApp.getState().analysisResults).toHaveLength(0);
    });

    it("a different further-source set is a different computation", () => {
      commitAnalysisOutput(multi());
      expect(commitAnalysisOutput(request()).kind).toBe("created");
    });
  });
});
