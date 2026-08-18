import { beforeEach, describe, expect, it } from "vitest";

import type { QuickFigureMapping } from "../lib/quickFigureMapping";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

function dataset(id: string, technique = "magnetometry.mvsh", workbookId?: string): Dataset {
  return {
    id,
    name: `${id}.dat`,
    workbookId,
    data: {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [3, 30]],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: { technique },
    },
  };
}

function mapping(overrides: Partial<QuickFigureMapping> = {}): QuickFigureMapping {
  return { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [1], ...overrides };
}

beforeEach(() => {
  useApp.setState({
    datasets: [dataset("d1")],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    techniqueViewMemory: {},
    quickPlotTemplates: [],
    history: [],
    future: [],
    status: "",
  });
});

describe("saveQuickPlotTemplate (H3)", () => {
  it("saves a named template with the default schema scope, capturing technique/signature/labels", () => {
    const before = useApp.getState().quickPlotTemplates.length;
    const historyBefore = useApp.getState().history.length;
    const id = useApp.getState().saveQuickPlotTemplate("d1", mapping(), "line", "My Template", { kind: "schema" });
    expect(id).not.toBeNull();
    const { quickPlotTemplates, history } = useApp.getState();
    expect(quickPlotTemplates).toHaveLength(before + 1);
    expect(history.length).toBe(historyBefore + 1);
    const t = quickPlotTemplates[0];
    expect(t.name).toBe("My Template");
    expect(t.technique).toBe("magnetometry.mvsh");
    expect(t.scope).toEqual({ kind: "schema" });
    expect(t.mapping).toEqual(mapping());
    expect(t.labels).toEqual({ 0: "A" });
  });

  it("supports the workbook scope explicitly", () => {
    useApp.setState({ datasets: [dataset("d1", "magnetometry.mvsh", "wb-1")] });
    const id = useApp.getState().saveQuickPlotTemplate("d1", mapping(), "line", "One-off", { kind: "workbook", workbookId: "wb-1" });
    expect(id).not.toBeNull();
    expect(useApp.getState().quickPlotTemplates[0].scope).toEqual({ kind: "workbook", workbookId: "wb-1" });
  });

  // NEVER overwrite (frozen contract): a duplicate name dedupes.
  it("never overwrites a same-named template -- dedupes the name instead", () => {
    useApp.getState().saveQuickPlotTemplate("d1", mapping(), "line", "Dup", { kind: "schema" });
    useApp.getState().saveQuickPlotTemplate("d1", mapping(), "line", "Dup", { kind: "schema" });
    const { quickPlotTemplates } = useApp.getState();
    expect(quickPlotTemplates).toHaveLength(2);
    expect(quickPlotTemplates.map((t) => t.name)).toEqual(["Dup", "Dup (2)"]);
    expect(quickPlotTemplates[0].id).not.toBe(quickPlotTemplates[1].id);
  });

  it("fails closed on a mapping that does not pass canCreateQuickFigure (zero Y series), zero mutation", () => {
    const before = useApp.getState().quickPlotTemplates.length;
    const historyBefore = useApp.getState().history.length;
    const id = useApp.getState().saveQuickPlotTemplate("d1", mapping({ yKeys: [] }), "line", "Bad", { kind: "schema" });
    expect(id).toBeNull();
    expect(useApp.getState().quickPlotTemplates).toHaveLength(before);
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  it("fails closed when the dataset does not exist, zero mutation", () => {
    const id = useApp.getState().saveQuickPlotTemplate("nope", mapping(), "line", "X", { kind: "schema" });
    expect(id).toBeNull();
    expect(useApp.getState().quickPlotTemplates).toHaveLength(0);
  });
});

describe("renameQuickPlotTemplate / deleteQuickPlotTemplate (+ undo) (H3)", () => {
  function saved(): string {
    return useApp.getState().saveQuickPlotTemplate("d1", mapping(), "line", "Original", { kind: "schema" })!;
  }

  it("renames a template and records ONE undoable history entry", () => {
    const id = saved();
    const historyBefore = useApp.getState().history.length;
    useApp.getState().renameQuickPlotTemplate(id, "Renamed");
    expect(useApp.getState().quickPlotTemplates.find((t) => t.id === id)?.name).toBe("Renamed");
    expect(useApp.getState().history.length).toBe(historyBefore + 1);

    useApp.getState().undo();
    expect(useApp.getState().quickPlotTemplates.find((t) => t.id === id)?.name).toBe("Original");
  });

  it("rename is a no-op for an unknown id or a blank name", () => {
    const id = saved();
    const historyBefore = useApp.getState().history.length;
    useApp.getState().renameQuickPlotTemplate("nope", "X");
    useApp.getState().renameQuickPlotTemplate(id, "   ");
    expect(useApp.getState().quickPlotTemplates.find((t) => t.id === id)?.name).toBe("Original");
    expect(useApp.getState().history.length).toBe(historyBefore);
  });

  // Review-round P3(2): renaming to a name ANOTHER template already holds
  // must dedupe (the saveQuickPlotTemplate discipline), never produce two
  // rows sharing one label.
  it("renaming to an existing name dedupes rather than colliding", () => {
    const id = saved(); // "Original"
    useApp.getState().saveQuickPlotTemplate("d1", mapping(), "line", "Taken", { kind: "schema" });

    useApp.getState().renameQuickPlotTemplate(id, "Taken");

    const names = useApp.getState().quickPlotTemplates.map((t) => t.name);
    expect(names).toEqual(["Taken (2)", "Taken"]);
  });

  it("renaming a template to its OWN current name (idempotent) is still a no-op, not a self-dedupe to '(2)'", () => {
    const id = saved(); // "Original"
    const historyBefore = useApp.getState().history.length;
    useApp.getState().renameQuickPlotTemplate(id, "Original");
    expect(useApp.getState().quickPlotTemplates.find((t) => t.id === id)?.name).toBe("Original");
    expect(useApp.getState().history.length).toBe(historyBefore);
  });

  it("deletes a template and undo restores it (the savedRois-incident pin)", () => {
    const id = saved();
    const countBefore = useApp.getState().quickPlotTemplates.length;
    useApp.getState().deleteQuickPlotTemplate(id);
    expect(useApp.getState().quickPlotTemplates.find((t) => t.id === id)).toBeUndefined();

    useApp.getState().undo();
    expect(useApp.getState().quickPlotTemplates).toHaveLength(countBefore);
    expect(useApp.getState().quickPlotTemplates.find((t) => t.id === id)).toBeDefined();
  });

  it("delete is a no-op for an unknown id", () => {
    const historyBefore = useApp.getState().history.length;
    useApp.getState().deleteQuickPlotTemplate("nope");
    expect(useApp.getState().history.length).toBe(historyBefore);
  });
});

describe("applyQuickPlotTemplate (H3 apply delegates to the canonical create path)", () => {
  function saved(): string {
    return useApp.getState().saveQuickPlotTemplate("d1", mapping(), "line", "T", { kind: "schema" })!;
  }

  it("delegates to createQuickFigureFromMapping -- ONE undo removes the figure AND the window entirely", () => {
    const id = saved();
    const windowsBefore = useApp.getState().plotWindows.length;
    const figuresBefore = useApp.getState().editableFigures.length;

    const ok = useApp.getState().applyQuickPlotTemplate(id, "d1");

    expect(ok).toBe(true);
    expect(useApp.getState().editableFigures.length).toBe(figuresBefore + 1);
    expect(useApp.getState().plotWindows.length).toBe(windowsBefore + 1);

    useApp.getState().undo();

    expect(useApp.getState().editableFigures.length).toBe(figuresBefore);
    expect(useApp.getState().plotWindows.length).toBe(windowsBefore);
  });

  it("never mutates quickPlotTemplates itself (apply is not a second save)", () => {
    const id = saved();
    const before = useApp.getState().quickPlotTemplates;
    useApp.getState().applyQuickPlotTemplate(id, "d1");
    expect(useApp.getState().quickPlotTemplates).toBe(before);
  });

  it("fails closed for an unknown template id, zero mutation", () => {
    const before = useApp.getState().editableFigures.length;
    const ok = useApp.getState().applyQuickPlotTemplate("nope", "d1");
    expect(ok).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(before);
    expect(useApp.getState().status).toContain("Quick Plot With unavailable");
  });

  it("fails closed for an unknown dataset id, zero mutation", () => {
    const id = saved();
    const before = useApp.getState().editableFigures.length;
    const ok = useApp.getState().applyQuickPlotTemplate(id, "nope");
    expect(ok).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(before);
  });

  it("refuses (never partially applies) a template whose technique no longer matches the dataset", () => {
    const id = saved();
    useApp.setState({ datasets: [dataset("d1", "xrd.powder")] });
    const before = useApp.getState().editableFigures.length;
    const ok = useApp.getState().applyQuickPlotTemplate(id, "d1");
    expect(ok).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(before);
    expect(useApp.getState().status).toContain("unavailable");
  });

  it("scoped match/non-match: a workbook-scoped template refuses a dataset outside its workbook", () => {
    useApp.setState({ datasets: [dataset("d1", "magnetometry.mvsh", "wb-1")] });
    const id = useApp.getState().saveQuickPlotTemplate("d1", mapping(), "line", "Scoped", { kind: "workbook", workbookId: "wb-1" })!;
    useApp.setState({ datasets: [dataset("d1", "magnetometry.mvsh", "wb-2")] });
    const ok = useApp.getState().applyQuickPlotTemplate(id, "d1");
    expect(ok).toBe(false);
  });

  it("scoped match: a workbook-scoped template applies inside its own workbook", () => {
    useApp.setState({ datasets: [dataset("d1", "magnetometry.mvsh", "wb-1")] });
    const id = useApp.getState().saveQuickPlotTemplate("d1", mapping(), "line", "Scoped", { kind: "workbook", workbookId: "wb-1" })!;
    const ok = useApp.getState().applyQuickPlotTemplate(id, "d1");
    expect(ok).toBe(true);
  });
});
