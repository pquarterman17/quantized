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
  //
  // G5 review round: this used to seed a lone "+"-only Y error binding on
  // channel 1 (the SAME channel already doing duty as xKey) -- itself an
  // incomplete asymmetric pair, i.e. exactly the FIX 1 probe shape, which
  // the shared predicate now blocks. Use a dedicated 4-column dataset with a
  // genuinely COMPLETE +/- pair so this test keeps exercising "errors carry
  // through verbatim" without tripping the new gate.
  it("the created document is live-mode, carries the mapping's errors verbatim, and its xKey/yKeys match the mapping", () => {
    const richDataset: Dataset = {
      id: "d1",
      name: "d1.dat",
      data: {
        time: [0, 1, 2],
        values: [[1, 10, 0.1, 0.2], [2, 20, 0.2, 0.3], [3, 30, 0.3, 0.4]],
        labels: ["A", "B", "B_err+", "B_err-"],
        units: ["", "", "", ""],
        metadata: { technique: "generic" },
      },
    };
    useApp.setState({ datasets: [richDataset] });
    const completePair: ErrorBinding[] = [
      { channel: 2, target: 0, axis: "y", side: "+" },
      { channel: 3, target: 0, axis: "y", side: "-" },
    ];
    const m = mapping({ xKey: 1, yKeys: [0], errorBindings: completePair, ignoredKeys: [2, 3] });
    useApp.getState().createQuickFigureFromMapping("d1", m, "line");
    const doc = useApp.getState().editableFigures[0];
    expect(doc.data.mode).toBe("live");
    expect(doc.bindings.xKey).toBe(1);
    expect(doc.bindings.yKeys).toEqual([0]);
    expect(doc.bindings.errors).toEqual(completePair);
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

// G5 review round (P1, FIX 1): the store action must enforce the SAME gates
// as the Create button, via the ONE shared predicate (`canCreateQuickFigure`,
// lib/quickFigureMapping.ts). Before this fix, calling the action directly
// bypassed the button's role-filtered/incomplete-pair checks entirely --
// probe-confirmed by an independent reviewer: a lone "+" error binding, or a
// role-filtered-only Y mapping, both SUCCEEDED here and created a figure
// whose content silently vanished at render.
describe("createQuickFigureFromMapping gates on the shared canCreateQuickFigure predicate (G5 review round)", () => {
  // t1, THE probe shape: a half-complete asymmetric error pair (a "+" with
  // no matching "-") must block creation exactly like the button does.
  it("is a fail-closed no-op for a half-complete asymmetric Y error pair, zero mutation", () => {
    const before = useApp.getState().editableFigures.length;
    const windowsBefore = useApp.getState().plotWindows.length;
    const historyBefore = useApp.getState().history.length;
    const halfPair: ErrorBinding[] = [{ channel: 1, target: 0, axis: "y", side: "+" }];
    const m = mapping({ yKeys: [0], errorBindings: halfPair, ignoredKeys: [] });

    const result = useApp.getState().createQuickFigureFromMapping("d1", m, "line");

    expect(result).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(before);
    expect(useApp.getState().plotWindows).toHaveLength(windowsBefore);
    expect(useApp.getState().history).toHaveLength(historyBefore);
    expect(useApp.getState().status).toContain("missing");
  });

  // FIX 3(b), predicate half: the same probe shape on the X axis (a lone
  // `+` X-error binding, no `-` counterpart). The component-level half of
  // this case lives in QuickFigureBuilderWorkspace.test.tsx.
  it("is a fail-closed no-op for a half-complete X-axis error pair, zero mutation", () => {
    const before = useApp.getState().editableFigures.length;
    const xHalfPair: ErrorBinding[] = [{ channel: 1, target: -1, axis: "x", side: "+" }];
    const m = mapping({ xKey: null, yKeys: [0], errorBindings: xHalfPair, ignoredKeys: [] });

    const result = useApp.getState().createQuickFigureFromMapping("d1", m, "line");

    expect(result).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(before);
    expect(useApp.getState().status).toContain("X error");
  });

  // t2, THE other probe shape: a mapping whose ONLY assigned Y channel
  // carries a worksheet-level Label/Ignore role. `mappingReady` alone sees
  // this as assigned (yKeys.length > 0); only the shared predicate catches
  // that it will render as nothing.
  it("is a fail-closed no-op when the only assigned Y channel is role-filtered (Label/Ignore), zero mutation", () => {
    useApp.setState({ datasets: [{ ...dataset("d1"), channelRoles: { 0: "ignore" } }] });
    const before = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;
    const m = mapping({ yKeys: [0], errorBindings: [], ignoredKeys: [] });

    const result = useApp.getState().createQuickFigureFromMapping("d1", m, "line");

    expect(result).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(before);
    expect(useApp.getState().history).toHaveLength(historyBefore);
    expect(useApp.getState().status).toContain("Label/Ignore");
  });

  // t3, control: a complete, unfiltered mapping is unaffected by the new
  // gate -- it still creates.
  it("still creates for a complete, unfiltered mapping (control)", () => {
    const before = useApp.getState().editableFigures.length;

    const result = useApp.getState().createQuickFigureFromMapping("d1", mapping(), "line");

    expect(result).toBe(true);
    expect(useApp.getState().editableFigures).toHaveLength(before + 1);
  });
});
