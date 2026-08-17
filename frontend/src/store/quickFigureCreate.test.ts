import { beforeEach, describe, expect, it } from "vitest";

import type { ErrorBinding } from "../lib/errorRoles";
import type { QuickFigureMapping } from "../lib/quickFigureMapping";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

function dataset(id: string): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [3, 30]],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: { technique: "generic" },
    },
  };
}

const asymmetricErrors: ErrorBinding[] = [
  { channel: 1, target: 0, axis: "y", side: "+" },
];

function mapping(overrides: Partial<QuickFigureMapping> = {}): QuickFigureMapping {
  return {
    xKey: null,
    yKeys: [0],
    errorBindings: [],
    ignoredKeys: [1],
    ...overrides,
  };
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
    history: [],
    future: [],
    status: "",
  });
});

describe("createQuickFigureFromMapping (G4)", () => {
  it("creates a NEW live editable figure, records ONE history entry, and opens it, returning true", () => {
    const before = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;
    const result = useApp.getState().createQuickFigureFromMapping("d1", mapping(), "line");
    expect(result).toBe(true);

    const { editableFigures, history, plotWindows } = useApp.getState();
    expect(editableFigures).toHaveLength(before + 1);
    const doc = editableFigures[editableFigures.length - 1];
    expect(doc.name).toBe("Quick Figure — d1.dat");
    expect(history.length).toBe(historyBefore + 1);

    const opened = plotWindows.find((w) => w.kind === "plot" && w.document?.id === doc.id);
    expect(opened).toBeDefined();
    expect(useApp.getState().focusedWindowId).toBe(opened!.id);
  });

  // t1, THE pin (mirrors quickPlotAction.test.ts's fix #4 case): the WHOLE
  // gesture (window + document + attach + focus) is ONE undo entry --
  // createWindow's own recordHistory is the only one.
  it("ONE undo after createQuickFigureFromMapping removes the figure document AND the window entirely", () => {
    const windowsBefore = useApp.getState().plotWindows.length;
    const figuresBefore = useApp.getState().editableFigures.length;
    useApp.getState().createQuickFigureFromMapping("d1", mapping(), "line");
    expect(useApp.getState().editableFigures.length).toBe(figuresBefore + 1);
    expect(useApp.getState().plotWindows.length).toBe(windowsBefore + 1);

    useApp.getState().undo();

    expect(useApp.getState().editableFigures.length).toBe(figuresBefore);
    expect(useApp.getState().plotWindows.length).toBe(windowsBefore);
  });

  // t2: fresh id + name dedupe on repeat creates.
  it("never replaces an existing figure — running it twice yields TWO documents with distinct ids AND distinct, deduped names", () => {
    useApp.getState().createQuickFigureFromMapping("d1", mapping(), "line");
    useApp.getState().createQuickFigureFromMapping("d1", mapping(), "line");
    const { editableFigures } = useApp.getState();
    expect(editableFigures).toHaveLength(2);
    expect(editableFigures[0].id).not.toBe(editableFigures[1].id);
    expect(editableFigures.map((d) => d.name)).toEqual([
      "Quick Figure — d1.dat",
      "Quick Figure — d1.dat (2)",
    ]);
    expect(editableFigures.every((doc) => doc.bindings.datasetId === "d1")).toBe(true);
  });

  // t3: vanished dataset -> fail-closed no-op.
  it("is a fail-closed no-op when the dataset id does not exist, returns false, zero mutation, no history entry", () => {
    const before = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;
    const result = useApp.getState().createQuickFigureFromMapping("does-not-exist", mapping(), "line");
    expect(result).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(before);
    expect(useApp.getState().history).toHaveLength(historyBefore);
    expect(useApp.getState().status).toContain("Quick Figure Builder unavailable");
  });

  // t4: live-mode document; bindings carry the mapping's errors verbatim;
  // bindings.xKey/yKeys match the mapping.
  it("the created document is live-mode, carries the mapping's errors verbatim, and its xKey/yKeys match the mapping", () => {
    const m = mapping({ xKey: 1, yKeys: [0], errorBindings: asymmetricErrors, ignoredKeys: [] });
    useApp.getState().createQuickFigureFromMapping("d1", m, "line");
    const doc = useApp.getState().editableFigures[0];
    expect(doc.data.mode).toBe("live");
    expect(doc.bindings.xKey).toBe(1);
    expect(doc.bindings.yKeys).toEqual([0]);
    expect(doc.bindings.errors).toEqual(asymmetricErrors);
  });

  // t5: mappingReady=false -> fail-closed no-op (belt-and-braces; the button
  // is also gated).
  it("is a fail-closed no-op when the mapping is not ready (zero Y series), returns false, zero mutation", () => {
    const before = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;
    const result = useApp.getState().createQuickFigureFromMapping("d1", mapping({ yKeys: [] }), "line");
    expect(result).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(before);
    expect(useApp.getState().history).toHaveLength(historyBefore);
    expect(useApp.getState().status).toContain("Quick Figure Builder unavailable");
  });
});
