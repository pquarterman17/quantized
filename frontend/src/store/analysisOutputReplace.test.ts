// Lane RO: a commit from a tool reopened on a committed result REPLACES the old
// output in place (same worksheet id, same result id) as ONE undo step, fails
// closed when the old output was edited, and keeps the stale state honest
// across Undo even though `staleDatasets` itself is not undone.
import { beforeEach, describe, expect, it } from "vitest";

import { analysisDataFingerprint, stampAnalysisResults } from "../lib/analysisResultFreshness";
import { staleAnalysisOutputs } from "../lib/analysisResultStaleLoad";
import { REOPEN_PARAM, committedOutputsOf } from "../lib/committedOutputGraph";
import { findCommittedResultId } from "../lib/committedOutput";
import type { Dataset, DataStruct } from "../lib/types";
import { commitAnalysisOutput, commitKeyFor, type AnalysisOutputCommit } from "./analysisOutputCommit";
import { useApp } from "./useApp";

const data = (values: number[]): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["y"], units: [""], metadata: {},
});
const SOURCE: Dataset = { id: "src", name: "Film", data: data([1, 2, 3]) };
const PRODUCER = { id: "ellipse-fit", label: "Ellipse fit", version: 1 };

function request(settings: Record<string, unknown>, fill: number, overrides: Partial<AnalysisOutputCommit> = {}): AnalysisOutputCommit {
  const source = useApp.getState().datasets.find((d) => d.id === "src")!;
  return {
    producer: PRODUCER, sourceId: "src", computedOn: analysisDataFingerprint(source), settings,
    output: (s) => ({ name: `${s.name} (fit ${fill})`, data: data([fill, fill, fill]) }),
    ...overrides,
  };
}

const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "src");

beforeEach(() => {
  useApp.setState({
    datasets: [SOURCE], activeId: "src", analysisResults: [], history: [], future: [],
    staleDatasets: [], staleFits: [], recalcMode: "manual", status: "",
  });
});

function commitFirst(): { resultId: string; outputId: string } {
  const first = commitAnalysisOutput(request({ geometric: true }, 1));
  if (first.kind !== "created") throw new Error("setup");
  return { resultId: first.resultId, outputId: first.outputId };
}

describe("replacing a committed output (Open in <tool>)", () => {
  it("refuses to replace a multi-output result (one worksheet would keep the old computation's other parts)", () => {
    const { resultId, outputId } = commitFirst();
    const extra: Dataset = { id: "extra", name: "Film (part 2)", data: data([2, 2, 2]) };
    useApp.setState((s) => ({
      datasets: [...s.datasets, extra],
      analysisResults: s.analysisResults.map((r) => ({ ...r, outputs: [...r.outputs, { datasetId: "extra", role: "linked-worksheet" as const, part: "sld" }] })),
    }));
    const before = useApp.getState();
    const outcome = commitAnalysisOutput(request({ geometric: false }, 7, { replace: resultId }));
    expect(outcome.kind).toBe("refused");
    expect(useApp.getState().datasets).toBe(before.datasets);
    expect(useApp.getState().analysisResults).toBe(before.analysisResults);
    expect(useApp.getState().datasets.find((d) => d.id === outputId)?.name).toBe("Film (fit 1)");
  });

  it("records what a reopen needs: the source view, the output view and the tool extras", () => {
    commitAnalysisOutput(request({ geometric: true }, 1, { reopenExtra: { p0: ["1"] } }));
    const [result] = useApp.getState().analysisResults;
    expect(result.parameters?.[REOPEN_PARAM]).toEqual({
      computedOn: analysisDataFingerprint(SOURCE), output: analysisDataFingerprint(outputs()[0]), name: "Film (fit 1)", extra: { p0: ["1"] },
    });
  });

  it("writes into the same worksheet and result as ONE undo step; Undo restores both", () => {
    const { resultId, outputId } = commitFirst();
    const before = useApp.getState().analysisResults[0];
    const outcome = commitAnalysisOutput(request({ geometric: false }, 7, { replace: resultId }));
    expect(outcome).toEqual({ kind: "replaced", resultId, outputId });
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0]).toMatchObject({ id: outputId, name: "Film (fit 7)" });
    expect(outputs()[0].data.values).toEqual([[7], [7], [7]]);
    const [after] = useApp.getState().analysisResults;
    expect(after.id).toBe(resultId);
    expect(after.parameters?.["settings"]).toEqual({ geometric: false });
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).toBeDefined();
    expect(useApp.getState().history).toHaveLength(2); // the first add + ONE replace

    useApp.getState().undo();
    expect(outputs()[0].data.values).toEqual([[1], [1], [1]]);
    expect(useApp.getState().analysisResults).toEqual([before]);
    useApp.getState().redo();
    expect(outputs()[0].data.values).toEqual([[7], [7], [7]]);
  });

  it("is idempotent: the same computation again replaces nothing", () => {
    const { resultId } = commitFirst();
    const outcome = commitAnalysisOutput(request({ geometric: true }, 1, { replace: resultId }));
    expect(outcome.kind).toBe("existing");
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("keeps a user's rename of the output worksheet, across repeated replaces", () => {
    const { resultId, outputId } = commitFirst();
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === outputId ? { ...d, name: "My ellipse" } : d)) }));
    commitAnalysisOutput(request({ geometric: false }, 7, { replace: resultId }));
    expect(outputs()[0].name).toBe("My ellipse");
    commitAnalysisOutput(request({ geometric: true }, 9, { replace: resultId }));
    expect(outputs()[0].name).toBe("My ellipse");
  });

  it("an unrenamed output follows the tool's new name", () => {
    const { resultId } = commitFirst();
    commitAnalysisOutput(request({ geometric: false }, 7, { replace: resultId }));
    commitAnalysisOutput(request({ geometric: true }, 9, { replace: resultId }));
    expect(outputs()[0].name).toBe("Film (fit 9)");
  });

  it("refuses when the output carries worksheet edits shaped by its old data (column roles)", () => {
    const { resultId, outputId } = commitFirst();
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === outputId ? { ...d, channelRoles: { 0: "label" as const } } : d)) }));
    const outcome = commitAnalysisOutput(request({ geometric: false }, 7, { replace: resultId }));
    expect(outcome.kind).toBe("refused");
    expect(useApp.getState().status).toContain("channelRoles");
    expect(outputs()[0].data.values).toEqual([[1], [1], [1]]);
  });

  it("refuses (writes nothing) when the output worksheet was edited after it was added", () => {
    const { resultId, outputId } = commitFirst();
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === outputId ? { ...d, data: data([1, 5, 1]) } : d)) }));
    const outcome = commitAnalysisOutput(request({ geometric: false }, 7, { replace: resultId }));
    expect(outcome.kind).toBe("refused");
    expect(useApp.getState().status).toContain("was edited after it was added");
    expect(outputs()[0].data.values).toEqual([[1], [5], [1]]);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("an Undo of a replace brings back a STALE old output as stale, not as current", () => {
    const { resultId, outputId } = commitFirst();
    const oldKey = commitKeyFor(request({ geometric: true }, 1));
    // The source changes: the output is stale (session state, outside undo).
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "src" ? { ...d, data: data([4, 5, 6]) } : d)) }));
    useApp.getState().touchDataset("src");
    expect(useApp.getState().staleDatasets).toEqual([outputId]);
    commitAnalysisOutput(request({ geometric: true }, 2, { replace: resultId }));
    expect(useApp.getState().staleDatasets).toEqual([]);
    expect(useApp.getState().analysisResults[0].stale).toBeUndefined();

    useApp.getState().undo();
    const restored = useApp.getState().analysisResults[0];
    expect(restored.stale).toBe(true);
    // ...so the old computation no longer blocks a commit as if it were current.
    const s = useApp.getState();
    expect(findCommittedResultId(s.analysisResults, s.datasets, s.staleDatasets, oldKey)).toBeNull();
    // ...and a save keeps it stale, so the reopened file marks it stale again.
    const saved = stampAnalysisResults(s.analysisResults, s.datasets, s.staleDatasets);
    expect(saved[0].stale).toBe(true);
    expect(staleAnalysisOutputs(saved, s.datasets)).toEqual([outputId]);
  });
});

// Lane RO2, IR suspected item 3. Fail-before: with Replace chosen, a computation
// whose key matched ANOTHER current result returned that result ("existing")
// and replaced nothing, while looking like it had.
describe("Replace when another current result already holds the computation", () => {
  it("refuses with the reason, naming the other output, and writes nothing", () => {
    const { resultId } = commitFirst(); // R1: geometric
    const second = commitAnalysisOutput(request({ geometric: false }, 7)); // R2: Add as new
    if (second.kind !== "created") throw new Error("setup");
    const before = useApp.getState();
    const outcome = commitAnalysisOutput(request({ geometric: false }, 7, { replace: resultId }));
    expect(outcome.kind).toBe("refused");
    expect(outcome.kind === "refused" && outcome.reason).toContain("already holds this exact computation");
    expect(outcome.kind === "refused" && outcome.reason).toContain("Film (fit 7)");
    expect(outcome.kind === "refused" && outcome.reason).toContain("nothing was changed");
    expect(useApp.getState().datasets).toBe(before.datasets);
    expect(useApp.getState().analysisResults).toBe(before.analysisResults);
    expect(useApp.getState().history).toHaveLength(2);
    expect(useApp.getState().status).toContain("already holds this exact computation");
  });

  it("Add as new still goes to the existing result, as before", () => {
    commitFirst();
    const second = commitAnalysisOutput(request({ geometric: false }, 7));
    if (second.kind !== "created") throw new Error("setup");
    expect(commitAnalysisOutput(request({ geometric: false }, 7))).toMatchObject({ kind: "existing", resultId: second.resultId });
  });

  it("an unchanged computation of the target itself is still just 'existing' (nothing to replace)", () => {
    const { resultId } = commitFirst();
    expect(commitAnalysisOutput(request({ geometric: true }, 1, { replace: resultId }))).toMatchObject({ kind: "existing", resultId });
  });

  it("a stale holder of the computation does not block the replace", () => {
    const { resultId } = commitFirst();
    const second = commitAnalysisOutput(request({ geometric: false }, 7));
    if (second.kind !== "created") throw new Error("setup");
    useApp.setState({ staleDatasets: [second.outputId] });
    expect(commitAnalysisOutput(request({ geometric: false }, 7, { replace: resultId })).kind).toBe("replaced");
  });
});

describe("duplicating a committed output (result lifecycle row 12)", () => {
  it("is ONE undo step, and the copy keeps the commit key without breaking dedupe, Replace or staleness", async () => {
    const { resultId, outputId } = commitFirst();
    const { duplicateAnalysisResult } = await import("./analysisResultActions");
    const depth = useApp.getState().history.length;
    const copyId = await duplicateAnalysisResult(resultId);
    expect(copyId).not.toBeNull();
    expect(useApp.getState().history.length).toBe(depth + 1);
    const [orig, copy] = useApp.getState().analysisResults;
    expect(copy.parameters?.["commitKey"]).toBe(orig.parameters?.["commitKey"]);
    const copyOutput = copy.outputs[0].datasetId;
    expect(copyOutput).not.toBe(outputId);

    // An identical later run finds the FIRST match and adds nothing.
    const again = commitAnalysisOutput(request({ geometric: true }, 1));
    expect(again).toMatchObject({ kind: "existing", resultId: orig.id });
    expect(outputs()).toHaveLength(2);

    // Replace of the original with new settings leaves the copy untouched.
    expect(commitAnalysisOutput(request({ geometric: false }, 7, { replace: resultId })).kind).toBe("replaced");
    expect(useApp.getState().analysisResults.find((r) => r.id === copyId)!.parameters?.["commitKey"]).toBe(orig.parameters?.["commitKey"]);

    // Undo removes the replace, then the duplicate (one step each).
    useApp.getState().undo();
    useApp.getState().undo();
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(outputs()).toHaveLength(1);
  });

  it("a source change marks the copy stale like the original", async () => {
    const { resultId } = commitFirst();
    const { duplicateAnalysisResult } = await import("./analysisResultActions");
    await duplicateAnalysisResult(resultId);
    const stale = committedOutputsOf(useApp.getState().analysisResults, ["src"]);
    expect(stale).toHaveLength(2);
  });
});

describe("repeated Duplicate clicks (acceptance row 11)", () => {
  it("a second click while the output is still resolving adds nothing", async () => {
    const { resultId } = commitFirst();
    const { duplicateAnalysisResult } = await import("./analysisResultActions");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const real = useApp.getState().resolveDataset;
    useApp.setState({ resolveDataset: async (id: string) => { await gate; return real(id); } } as never);
    const depth = useApp.getState().history.length;
    const first = duplicateAnalysisResult(resultId);
    const second = await duplicateAnalysisResult(resultId);
    expect(second).toBeNull();
    expect(useApp.getState().status).toMatch(/already duplicating/);
    release();
    expect(await first).not.toBeNull();
    expect(useApp.getState().analysisResults).toHaveLength(2);
    expect(outputs()).toHaveLength(2);
    expect(useApp.getState().history.length).toBe(depth + 1);
    useApp.setState({ resolveDataset: real } as never);
  });
});
