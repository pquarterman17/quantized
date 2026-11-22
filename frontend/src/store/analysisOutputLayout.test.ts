// Lane RPL: Replace in place follows what is bound to the old output's columns
// BY NAME (reorder, add, drop), and fails closed, by name, when a bound column
// would vanish or become ambiguous: before the commit and again AT commit time.
import { beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../lib/formulaExt";

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView } from "../lib/plotview";
import { emptySpec, type PlotSpec } from "../lib/plotspec";
import type { Dataset, DataStruct } from "../lib/types";
import { commitAnalysisOutput, type AnalysisOutputCommit } from "./analysisOutputCommit";
import { outputLayoutVerdict } from "./analysisOutputLayout";
import { useToolReopen } from "./toolReopen";
import { useApp } from "./useApp";

const table = (labels: readonly string[]): DataStruct => ({
  time: [0, 1, 2],
  values: [0, 1, 2].map((r) => labels.map((l) => r * 10 + l.charCodeAt(0))),
  labels: [...labels], units: labels.map(() => ""), metadata: {},
});
const SOURCE: Dataset = { id: "src", name: "Film", data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } };
const PRODUCER = { id: "ellipse-fit", label: "Ellipse fit", version: 1 };

function request(settings: Record<string, unknown>, labels: readonly string[], replace?: string): AnalysisOutputCommit {
  const source = useApp.getState().datasets.find((d) => d.id === "src")!;
  return {
    producer: PRODUCER, sourceId: "src", computedOn: analysisDataFingerprint(source), settings,
    output: () => ({ name: "Fit", data: table(labels) }), ...(replace ? { replace } : {}),
  };
}
const outputOf = () => useApp.getState().datasets.find((d) => d.id !== "src" && d.name !== "Graph")!;
const figure = (name: string, over: { yKeys?: number[]; xKey?: number | null; groupKey?: number | null }) =>
  createFigureDocument({
    id: `fig-${name}`, name, datasetId: outputOf().id,
    view: { ...defaultPlotView(), xKey: over.xKey ?? null, yKeys: over.yKeys ?? null }, groupKey: over.groupKey ?? null,
  });

function first(labels: readonly string[] = ["a", "b", "c"]): string {
  const created = commitAnalysisOutput(request({ n: 1 }, labels));
  if (created.kind !== "created") throw new Error("setup");
  return created.resultId;
}

beforeEach(() => {
  useApp.setState({
    datasets: [SOURCE], activeId: "src", analysisResults: [], history: [], future: [], plotWindows: [], focusedWindowId: null,
    editableFigures: [], figureDocs: [], savedPlotSpecs: [], staleDatasets: [], staleFits: [], recalcMode: "manual", status: "",
  });
  useToolReopen.setState({ sessions: {} });
});

describe("replace follows bound columns by name", () => {
  it("reorder: figure, saved graph, graph curve and result follow; Undo restores data AND bindings", () => {
    const resultId = first(["a", "b", "c"]);
    const id = outputOf().id;
    const spec: PlotSpec = { ...emptySpec(), zones: { ...emptySpec().zones, x: { datasetId: id, channel: 0 }, y: [{ datasetId: id, channel: 2 }] } };
    const other: Dataset = {
      id: "g", name: "Graph", data: table(["g"]),
      linkedCurves: [{ datasetId: id, xKey: 0, yKey: 2, label: "c" }],
    };
    useApp.setState((s) => ({
      editableFigures: [figure("Fig 1", { xKey: 0, yKeys: [2] })],
      savedPlotSpecs: [{ id: "ps", name: "Spec", createdAt: "t", modifiedAt: "t", spec }],
      datasets: [...s.datasets, other],
      analysisResults: [...s.analysisResults, {
        version: 1, id: "r2", name: "Peaks", producer: { id: "x", label: "X", version: 1 }, sources: [], outputs: [], warnings: [], createdAt: "t",
        plotBindings: [{ datasetId: id, channels: [2], xChannel: 0 }],
      } as never],
    }));
    const before = { figs: useApp.getState().editableFigures, specs: useApp.getState().savedPlotSpecs, ds: useApp.getState().datasets, res: useApp.getState().analysisResults };

    const out = commitAnalysisOutput(request({ n: 2 }, ["c", "a", "b"], resultId));
    expect(out.kind).toBe("replaced");
    const s = useApp.getState();
    expect(outputOf().data.labels).toEqual(["c", "a", "b"]);
    expect(s.editableFigures[0].bindings.xKey).toBe(1); // "a"
    expect(s.editableFigures[0].bindings.yKeys).toEqual([0]); // "c"
    expect(s.savedPlotSpecs[0].spec.zones.x?.channel).toBe(1);
    expect(s.savedPlotSpecs[0].spec.zones.y[0]?.channel).toBe(0);
    expect(s.datasets.find((d) => d.id === "g")!.linkedCurves).toEqual([{ datasetId: id, xKey: 1, yKey: 0, label: "c" }]);
    const peaks = s.analysisResults.find((r) => r.id === "r2")!;
    expect(peaks.plotBindings).toEqual([{ datasetId: id, channels: [0], xChannel: 1 }]);

    useApp.getState().undo();
    const u = useApp.getState();
    expect(outputOf().data.labels).toEqual(["a", "b", "c"]);
    expect(u.editableFigures).toEqual(before.figs);
    expect(u.savedPlotSpecs).toEqual(before.specs);
    expect(u.datasets.find((d) => d.id === "g")).toEqual(before.ds.find((d) => d.id === "g"));
    expect(u.analysisResults.find((r) => r.id === "r2")).toEqual(before.res.find((r) => r.id === "r2"));
  });

  it("an unbound column removed or added: Replace is allowed and bound columns still follow", () => {
    const resultId = first(["a", "b", "c"]);
    useApp.setState({ editableFigures: [figure("Fig 1", { xKey: 0, yKeys: [2] })] });
    const out = commitAnalysisOutput(request({ n: 2 }, ["new", "a", "c", "extra"], resultId));
    expect(out.kind).toBe("replaced");
    const doc = useApp.getState().editableFigures[0];
    expect(doc.bindings.xKey).toBe(1);
    expect(doc.bindings.yKeys).toEqual([2]);
  });
});

describe("replace fails closed, by name", () => {
  it("a removed bound column refuses the replace with its reason; nothing is written; Add as new still works", () => {
    const resultId = first(["a", "b", "χ"]);
    const id = outputOf().id;
    useApp.setState({ editableFigures: [figure("Figure 2", { yKeys: [2] })] });
    useApp.setState((s) => ({ analysisResults: [...s.analysisResults, {
      version: 1, id: "r2", name: "Report 1", producer: { id: "x", label: "X", version: 1 }, sources: [], outputs: [], warnings: [], createdAt: "t",
      plotBindings: [{ datasetId: id, channels: [2] }],
    } as never] }));
    const verdict = outputLayoutVerdict(useApp.getState(), id, ["a", "b"], resultId);
    expect(verdict).toEqual({ ok: false, reason: expect.stringContaining("Replace would remove column ‘χ’ used by figure “Figure 2” and result “Report 1”") });

    const before = useApp.getState().datasets;
    const out = commitAnalysisOutput(request({ n: 2 }, ["a", "b"], resultId));
    expect(out.kind).toBe("refused");
    expect(useApp.getState().status).toContain("‘χ’");
    expect(useApp.getState().datasets).toBe(before);
    expect(useApp.getState().editableFigures[0].bindings.yKeys).toEqual([2]);

    const added = commitAnalysisOutput(request({ n: 2 }, ["a", "b"]));
    expect(added.kind).toBe("created");
    expect(useApp.getState().datasets.filter((d) => d.name === "Fit")).toHaveLength(2);
  });

  it("a duplicated label on a bound column refuses (new side and old side)", () => {
    const resultId = first(["a", "b", "c"]);
    useApp.setState({ editableFigures: [figure("Fig", { yKeys: [1] })] });
    const id = outputOf().id;
    const dupNew = outputLayoutVerdict(useApp.getState(), id, ["a", "b", "b"], resultId);
    expect(dupNew.ok).toBe(false);
    expect(!dupNew.ok && dupNew.reason).toContain("‘b’");
    expect(commitAnalysisOutput(request({ n: 2 }, ["a", "b", "b"], resultId)).kind).toBe("refused");
    expect(outputOf().data.labels).toEqual(["a", "b", "c"]);
  });

  it("commit-time race: a figure bound AFTER the pre-commit check still blocks the replace", () => {
    const resultId = first(["a", "b", "c"]);
    const id = outputOf().id;
    const pre = outputLayoutVerdict(useApp.getState(), id, ["a", "b"], resultId);
    expect(pre.ok).toBe(true); // nothing uses "c" yet
    useApp.setState({ editableFigures: [figure("Late", { yKeys: [2] })] }); // ...then it is bound
    const out = commitAnalysisOutput(request({ n: 2 }, ["a", "b"], resultId));
    expect(out.kind).toBe("refused");
    expect(useApp.getState().status).toContain("figure “Late”");
    expect(outputOf().data.labels).toEqual(["a", "b", "c"]);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("a derived worksheet reading the output blocks any layout change but not an identical one", () => {
    const resultId = first(["a", "b", "c"]);
    const id = outputOf().id;
    useApp.setState((s) => ({ datasets: [...s.datasets, { id: "d", name: "Derived", data: table(["a"]), derivedFrom: { datasetId: id, pipeline: "p" } }] }));
    expect(commitAnalysisOutput(request({ n: 2 }, ["a", "b"], resultId)).kind).toBe("refused");
    expect(commitAnalysisOutput(request({ n: 3 }, ["a", "b", "c"], resultId)).kind).toBe("replaced");
  });
});

describe("sheet() readers", () => {
  it("a column another worksheet reads through sheet() blocks its removal, by name", async () => {
    await loadFormulaExtension();
    const resultId = first(["a", "b", "c"]);
    const id = outputOf().id;
    const reader: Dataset = {
      id: "rd", name: "Reader", data: table(["r", "F"]),
      formulas: [{ name: "F", expr: 'sheet("Fit", C)', sheets: [{ name: "Fit", id }] }],
    };
    useApp.setState((s) => ({ datasets: [...s.datasets, reader] }));
    const verdict = outputLayoutVerdict(useApp.getState(), id, ["a", "b"], resultId);
    expect(!verdict.ok && verdict.reason).toContain("‘c’");
    expect(!verdict.ok && verdict.reason).toContain("Reader");
    expect(outputLayoutVerdict(useApp.getState(), id, ["c", "a", "b"], resultId).ok).toBe(true);
  });
});

describe("the reopen session carries the pre-commit reason", () => {
  it("a layout block flips Replace to Add as new and refuses setMode('replace')", () => {
    const session = { resultId: "r", resultName: "R", sourceId: "src", sourceIds: ["src"], outputId: "o", outputName: "O", seed: null, extra: null, notice: null, replaceBlocked: null };
    useToolReopen.getState().start("ellipse-fit", session);
    expect(useToolReopen.getState().sessions["ellipse-fit"].mode).toBe("replace");
    useToolReopen.getState().setLayoutBlocked("ellipse-fit", "Replace would remove column ‘χ’");
    expect(useToolReopen.getState().sessions["ellipse-fit"].mode).toBe("new");
    useToolReopen.getState().setMode("ellipse-fit", "replace");
    expect(useToolReopen.getState().sessions["ellipse-fit"].mode).toBe("new");
    useToolReopen.getState().setLayoutBlocked("ellipse-fit", null);
    expect(useToolReopen.getState().sessions["ellipse-fit"].mode).toBe("replace"); // the automatic downgrade is undone
  });

  it("a mode the user picked is never overridden when a block clears", () => {
    const session = { resultId: "r", resultName: "R", sourceId: "src", sourceIds: ["src"], outputId: "o", outputName: "O", seed: null, extra: null, notice: null, replaceBlocked: null };
    useToolReopen.getState().start("ellipse-fit", session);
    useToolReopen.getState().setMode("ellipse-fit", "new");
    useToolReopen.getState().setLayoutBlocked("ellipse-fit", "x");
    useToolReopen.getState().setLayoutBlocked("ellipse-fit", null);
    expect(useToolReopen.getState().sessions["ellipse-fit"].mode).toBe("new");
  });
});
