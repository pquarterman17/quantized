// Review finding 3 + the guard gaps: every entry point that would write a
// column, correction or metadata into a live graph's sheet is refused with
// LINKED_GRAPH_EDIT_NOTICE, because the watcher re-assembles `data` from the
// sources and would silently revert it (finding 3 reproduced "applied" +
// params kept + values reverted). Also covers the row-statistics and recode
// guards, which had no test.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import { confirmErrorBindings } from "../lib/errorRoleConfirm";
import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import { LINKED_GRAPH_EDIT_NOTICE } from "../lib/rederived";
import type { Dataset } from "../lib/types";
import { applyMetadataCleanup, promoteFactor } from "../lib/metadataRun";
import { noteAssembled } from "./linkedCurvesSync";
import { askParams } from "./paramDialog";
import { useRecode } from "./recode";
import { toast } from "./toasts";
import { useApp } from "./useApp";
import { runRowStatistics } from "./worksheetStatsRun";

vi.mock("./paramDialog", () => ({ askParams: vi.fn() }));
vi.mock("./toasts", () => ({ toast: vi.fn() }));
vi.mock("../lib/api", () => ({
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
  fetchBookData: vi.fn(),
  importFile: vi.fn(),
  guessImportSettings: vi.fn(),
  parseImportText: vi.fn(),
  fitModel: vi.fn(),
}));

const plain = (id: string, y: number[]): Dataset => ({
  id,
  name: id,
  data: { time: [1, 2, 3], values: y.map((v) => [v, v]), labels: ["Y", "Z"], units: ["V", "A"], metadata: {} },
});
const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves)!;

beforeEach(async () => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [plain("a", [1, 2, 3]), plain("b", [4, 5, 6])], selectedIds: [], history: [], future: [], status: "" });
  await plotSelectedTogether(["a", "b"]);
  useApp.setState({ status: "", history: [] });
  useApp.setState({ activeId: graph().id });
});

describe("corrections on a live graph", () => {
  it("applyCorrections is refused: no backend call, graph untouched, notice shown", async () => {
    const g = graph();
    const ok = await useApp.getState().applyCorrections(g.id, { scale: 10 } as never);
    expect(ok).toBe(false);
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
    expect(graph()).toBe(g);
    expect(useApp.getState().status).toBe(LINKED_GRAPH_EDIT_NOTICE);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("resetCorrections is refused", () => {
    const g = graph();
    useApp.getState().resetCorrections(g.id);
    expect(graph()).toBe(g);
    expect(useApp.getState().status).toBe(LINKED_GRAPH_EDIT_NOTICE);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("copying corrections onto a graph (applyCorrectionsToMany) refuses that target and counts it as failed", async () => {
    const g = graph();
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, corrections: { scale: 2 } as never } : d)) }));
    const n = await useApp.getState().applyCorrectionsToMany("a", [g.id]);
    expect(n).toBe(0);
    expect(graph()).toBe(g);
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
  });
});

describe("metadata edits on a live graph", () => {
  it("promote-to-factor and metadata cleanup refuse a graph (their writes would be rebuilt away)", async () => {
    const g = graph();
    await expect(promoteFactor(useApp.getState, [g.id], ["sample"], "categorical", "S")).rejects.toThrow(/source workbooks/);
    await expect(
      applyMetadataCleanup(useApp.getState, [g.id], { unify: [], normalize: [{ key: "k", trim: true, letterCase: "keep", units: false }] }),
    ).rejects.toThrow(/source workbooks/);
    expect(graph()).toBe(g);
  });

  it("a confirmed error pairing on a graph survives the next rebuild", () => {
    confirmErrorBindings(graph().id, [{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(graph().data.metadata.error_roles).toBeDefined();
    const a = useApp.getState().datasets.find((d) => d.id === "a")!;
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...a, data: { ...a.data, values: [[9, 9], [9, 9], [9, 9]] } } : d)) }));
    expect(graph().data.values[0][0]).toBe(9); // it did rebuild ...
    expect(graph().data.metadata.error_roles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });
});

describe("row statistics and recode refuse a live graph", () => {
  it("runRowStatistics never opens the dialog nor adds a column", async () => {
    const g = graph();
    await runRowStatistics();
    expect(askParams).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe(LINKED_GRAPH_EDIT_NOTICE);
    expect(graph().formulas ?? []).toHaveLength(0);
    expect(graph().data).toBe(g.data);
  });

  it("commitRecode refuses, toasts the notice and adds no column", () => {
    const g = graph();
    const cat: Dataset = {
      ...g,
      data: { ...g.data, time: [0, 1, 2], values: [[0], [1], [2]], labels: ["Grade"], units: [""], cat_levels: { 0: ["Pass", "OK", "Fail"] } },
    };
    // (A graph is never categorical in practice; mark this one as assembled so
    // the watcher leaves the fixture alone and the guard itself is what refuses.)
    noteAssembled(cat, useApp.getState().datasets);
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === g.id ? cat : d)) }));
    useRecode.getState().openRecode(g.id, 0);
    useRecode.getState().setGroup("Passing", ["Pass", "OK"]);
    expect(useRecode.getState().commitRecode()).toBeNull();
    expect(toast).toHaveBeenCalledWith(LINKED_GRAPH_EDIT_NOTICE, "danger");
    expect(useApp.getState().datasets.find((d) => d.id === g.id)!.formulas ?? []).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
  });
});
