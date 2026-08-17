// G5 lifecycle proof (LIBRARY_WORKBOOK_UX_PLAN PR G5) — permanent regression
// pins for the owner's checklist, at the store layer (the real e2e journey
// lives in e2e/specs/quick-figure-lifecycle.spec.ts; this is the fast/CI-
// every-push half). Phase 0's probe found every seam here ALREADY correct —
// no fix was needed — but the chain (create -> edit a normal property ->
// save -> close -> reopen -> .dwk round trip -> undo/redo) had no permanent
// pin anywhere, so a regression in any one hand-off would have shipped
// silently. This is that pin.
import { beforeEach, describe, expect, it } from "vitest";

import type { QuickFigureMapping } from "../lib/quickFigureMapping";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";

function dataset(id: string): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [1.5, 30], [0.2, 5], [0.3, 4]],
      labels: ["X", "Y", "Yerr+", "Yerr-", "Xerr"],
      units: ["", "", "", "", ""],
      metadata: { technique: "generic" },
    },
  };
}

/** Alternate X, one Y series, one COMPLETE asymmetric Y pair, one X-error
 *  binding -- the owner's exact checklist shape. */
function richMapping(): QuickFigureMapping {
  return {
    xKey: 0,
    yKeys: [1],
    errorBindings: [
      { channel: 2, target: 1, axis: "y", side: "+" },
      { channel: 3, target: 1, axis: "y", side: "-" },
      { channel: 4, target: -1, axis: "x", side: "both" },
    ],
    ignoredKeys: [],
  };
}

const EXPECTED_ERRORS = [
  { channel: 2, target: 1, axis: "y", side: "+" },
  { channel: 3, target: 1, axis: "y", side: "-" },
  { channel: 4, target: -1, axis: "x", side: "both" },
];

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
  // The real app always has one base plot window open before any quick
  // figure is created (App.tsx) -- closeWindow refuses to drop below one
  // PLOT window, so a bare `[]` here would make the quick-figure window it
  // creates uncloseable, unlike the real app.
  useApp.getState().createWindow(null);
  useApp.setState({ history: [], future: [] });
});

describe("G5 lifecycle proof: create -> edit -> save -> close -> reopen -> .dwk round trip", () => {
  it("preserves asymmetric + X-error bindings and a property edit through the whole chain", () => {
    const ok = useApp.getState().createQuickFigureFromMapping("d1", richMapping(), "line");
    expect(ok).toBe(true);

    const afterCreate = useApp.getState();
    const docId = afterCreate.editableFigures[0].id;
    const winId = afterCreate.focusedWindowId!;
    expect(afterCreate.editableFigures[0].bindings.errors).toEqual(EXPECTED_ERRORS);

    // Modify a normal figure property the way the real UI does: a per-series
    // style edit (WindowTitleButtons' Save button commits the live facade;
    // the actual color picker is components/Inspector/SeriesStyleCard.tsx /
    // the plot canvas's right-click swatch menu -- both call this same
    // store action, which is the seam this pin protects).
    useApp.getState().setSeriesStyle(1, { color: "#ff00ff" });
    expect(useApp.getState().seriesStyles[1]?.color).toBe("#ff00ff");

    // Save (WindowTitleButtons' ✓/● button -> saveFigure).
    const savedId = useApp.getState().saveFigure(winId);
    expect(savedId).toBe(docId);
    const saved = useApp.getState().editableFigures.find((d) => d.id === docId)!;
    expect(saved.plot.view.seriesStyles[1]?.color).toBe("#ff00ff");
    expect(saved.bindings.errors).toEqual(EXPECTED_ERRORS);

    // Close (figureLifecycleUi.ts's closeFigureWindow, minus its UI confirm
    // gate -- editableFigureHasUnsavedEdits is false immediately after Save,
    // so the real close path would not prompt here either).
    useApp.getState().closeWindow(winId);
    expect(useApp.getState().plotWindows.some((w) => w.id === winId)).toBe(false);
    expect(useApp.getState().editableFigures.some((d) => d.id === docId)).toBe(true);

    // Reopen from Editable Figures (EditableFiguresSection's row -> openEditableFigure).
    const reopenedWinId = useApp.getState().openEditableFigure(docId);
    expect(reopenedWinId).toBeTruthy();
    const reopenedWin = useApp.getState().plotWindows.find((w) => w.id === reopenedWinId)!;
    expect(reopenedWin.document?.id).toBe(docId);
    expect(reopenedWin.document?.plot.view.seriesStyles[1]?.color).toBe("#ff00ff");
    expect(reopenedWin.document?.bindings.errors).toEqual(EXPECTED_ERRORS);

    // Save + reload the complete project (.dwk) -- the actual persistence
    // boundary, not just the in-memory store.
    const ws = serializeWorkspace(useApp.getState());
    const loaded = parseWorkspace(ws);
    const reloaded = loaded.editableFigures.find((d) => d.id === docId)!;
    expect(reloaded.plot.view.seriesStyles[1]?.color).toBe("#ff00ff");
    expect(reloaded.bindings.errors).toEqual(EXPECTED_ERRORS);
    expect(reloaded.bindings.xKey).toBe(0);
    expect(reloaded.bindings.yKeys).toEqual([1]);

    // Undo/Redo coherence: walk all the way back, then all the way forward,
    // and land on exactly the same state -- no orphaned windows/documents,
    // no resurrection of the closed window, no edit detaching from its
    // document.
    let guard = 0;
    while (useApp.getState().history.length > 0 && guard < 20) {
      useApp.getState().undo();
      guard += 1;
    }
    expect(useApp.getState().editableFigures.length).toBe(0);
    expect(useApp.getState().plotWindows.filter((w) => w.kind === "plot").length).toBeGreaterThanOrEqual(1);

    while (useApp.getState().future.length > 0) {
      useApp.getState().redo();
    }
    const final = useApp.getState();
    expect(final.editableFigures.length).toBe(1);
    expect(final.editableFigures[0].id).toBe(docId);
    expect(final.editableFigures[0].plot.view.seriesStyles[1]?.color).toBe("#ff00ff");
    expect(final.editableFigures[0].bindings.errors).toEqual(EXPECTED_ERRORS);
    // Exactly one window carries this document -- redo never duplicates it.
    expect(final.plotWindows.filter((w) => w.document?.id === docId).length).toBe(1);
  });

  it("undoing a single property edit reverts the live view without touching the window/document identity", () => {
    useApp.getState().createQuickFigureFromMapping("d1", richMapping(), "line");
    const winId = useApp.getState().focusedWindowId!;
    const docId = useApp.getState().editableFigures[0].id;

    useApp.getState().setYAxisLabel("first edit");
    useApp.getState().setYAxisLabel("second edit");
    expect(useApp.getState().yAxisLabel).toBe("second edit");

    useApp.getState().undo();
    expect(useApp.getState().yAxisLabel).toBe("first edit");
    expect(useApp.getState().focusedWindowId).toBe(winId);
    expect(useApp.getState().plotWindows.find((w) => w.id === winId)?.document?.id).toBe(docId);

    useApp.getState().redo();
    expect(useApp.getState().yAxisLabel).toBe("second edit");
    expect(useApp.getState().plotWindows.find((w) => w.id === winId)?.document?.id).toBe(docId);
  });
});
