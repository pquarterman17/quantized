// Quick Figure Builder Label + Grouping roles, store layer: the roles must
// reach the CREATED figure (canonical document, its window, the live focused
// facade the legend renders from), stay one undoable gesture, and survive the
// `.dwk` round trip -- both on the figure and inside a saved Quick Plot
// template that re-applies them.
import { beforeEach, describe, expect, it } from "vitest";

import type { QuickFigureMapping } from "../lib/quickFigureMapping";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";

function dataset(id: string): Dataset {
  return {
    id,
    name: `${id}.csv`,
    data: {
      time: [0, 1, 2, 3],
      values: [
        [10, 1, 0, 7],
        [20, 2, 1, 8],
        [30, 3, 0, 9],
        [40, 4, 1, 10],
      ],
      labels: ["temp", "R", "sample", "run"],
      units: ["K", "Ω", "", ""],
      metadata: { technique: "generic" },
      cat_levels: { 2: ["A", "B"] },
    },
  };
}

const roles: QuickFigureMapping = { xKey: 0, yKeys: [1], errorBindings: [], ignoredKeys: [], groupKey: 2, labelKey: 3 };

beforeEach(() => {
  useApp.setState({
    datasets: [dataset("d1"), dataset("d2")],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    quickPlotTemplates: [],
    // The live focused-window facade: reset so no earlier test's figure leaks in.
    groupKey: null,
    annotations: [],
    techniqueViewMemory: {},
    history: [],
    future: [],
    status: "",
  });
  useApp.getState().createWindow(null); // the app's always-present base window
  useApp.setState({ history: [], future: [] });
});

describe("createQuickFigureFromMapping — Grouping and Label roles reach the created figure", () => {
  it("groupKey lands in the document bindings, the window view, and the focused live facade", () => {
    expect(useApp.getState().createQuickFigureFromMapping("d1", roles, "line")).toBe(true);
    const state = useApp.getState();
    const doc = state.editableFigures[0];
    expect(doc.bindings.groupKey).toBe(2);
    expect(doc.plot.view).not.toHaveProperty("groupKey"); // bindings-owned, one authority
    const win = state.plotWindows.find((w) => w.document?.id === doc.id)!;
    expect(win.view.groupKey).toBe(2);
    expect(state.focusedWindowId).toBe(win.id);
    expect(state.groupKey).toBe(2); // what Stage/usePlotPayload splits the legend by
  });

  it("point labels are one annotation group, unique per figure, on the document and the live facade", () => {
    useApp.getState().createQuickFigureFromMapping("d1", roles, "line");
    useApp.getState().createQuickFigureFromMapping("d2", roles, "scatter");
    const [first, second] = useApp.getState().editableFigures;
    expect(first.plot.view.annotations.map((a) => [a.x, a.y, a.text])).toEqual([
      [10, 1, "7"], [20, 2, "8"], [30, 3, "9"], [40, 4, "10"],
    ]);
    expect(new Set(first.plot.view.annotations.map((a) => a.groupId))).toEqual(new Set([`quick-labels-${first.id}`]));
    const ids = [...first.plot.view.annotations, ...second.plot.view.annotations].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(useApp.getState().annotations).toEqual(second.plot.view.annotations);
  });

  it("stays ONE undoable gesture: a single undo removes the figure, its window, and its labels", () => {
    const windowsBefore = useApp.getState().plotWindows.length;
    useApp.getState().createQuickFigureFromMapping("d1", roles, "line");
    expect(useApp.getState().groupKey).toBe(2);
    expect(useApp.getState().annotations).toHaveLength(4);
    useApp.getState().undo();
    expect(useApp.getState().editableFigures).toEqual([]);
    expect(useApp.getState().plotWindows).toHaveLength(windowsBefore);
    expect(useApp.getState().groupKey).toBeNull();
    expect(useApp.getState().annotations).toEqual([]);
  });

  it("the grouping binding and the point labels survive a .dwk save/reload", () => {
    useApp.getState().createQuickFigureFromMapping("d1", roles, "line");
    const doc = useApp.getState().editableFigures[0];
    const loaded = parseWorkspace(serializeWorkspace(useApp.getState()));
    const reloaded = loaded.editableFigures.find((d) => d.id === doc.id)!;
    expect(reloaded.bindings.groupKey).toBe(2);
    expect(reloaded.plot.view.annotations).toEqual(doc.plot.view.annotations);
  });
});

describe("Quick Plot templates keep the roles across save, .dwk, and re-apply", () => {
  it("a template saved with Group by / Point labels re-applies them to a matching worksheet", () => {
    const templateId = useApp.getState().saveQuickPlotTemplate("d1", roles, "line", "Grouped", { kind: "schema" })!;
    const loaded = parseWorkspace(serializeWorkspace(useApp.getState()));
    const persisted = loaded.quickPlotTemplates.find((t) => t.id === templateId)!;
    expect(persisted.mapping.groupKey).toBe(2);
    expect(persisted.mapping.labelKey).toBe(3);

    expect(useApp.getState().applyQuickPlotTemplate(templateId, "d2")).toBe(true);
    const doc = useApp.getState().editableFigures[0];
    expect(doc.bindings.datasetId).toBe("d2");
    expect(doc.bindings.groupKey).toBe(2);
    expect(doc.plot.view.annotations.map((a) => a.text)).toEqual(["7", "8", "9", "10"]);
  });
});
