// Owner-routing item 1 (2026-07-09, "it's a bit confusing when I'm opening a
// plot vs workbook and then have to remember to toggle up"): "Plot
// selection"/"Add to plot" are plot-intent actions and must surface the Plot
// tab. The interesting case is when the worksheet's dataset is ALREADY the
// active plot dataset — plotCols's own `setActive` guard never fires then,
// so the fix has to force the tab directly (see plotCols's `wantTab` check).

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useWorksheetView } from "./useWorksheetView";

const ds: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [0, 1, 2],
    values: [
      [1, 10],
      [2, 20],
      [3, 30],
    ],
    labels: ["x", "y"],
    units: ["", ""],
    metadata: {},
  },
};

beforeEach(() => {
  useApp.setState({
    datasets: [ds],
    activeId: "d1", // already the active plot dataset
    stageTab: "worksheet",
    xKey: null,
    yKeys: null,
    graphBuilderOpen: false,
    graphBuilderSeed: null,
    originWorksheetSeed: null,
    selection: null,
    worksheetSelections: {}, // #14: isolate each test's per-window selections
  });
});

describe("useWorksheetView — Origin source selection (#50)", () => {
  it("consumes the one-shot exact-column seed into the local selection", () => {
    useApp.setState({ originWorksheetSeed: { datasetId: "d1", columns: [-1, 1] } });
    const { result } = renderHook(() => useWorksheetView(ds));
    expect([...result.current.selectedCols]).toEqual([-1, 1]);
    expect(useApp.getState().originWorksheetSeed).toBeNull();
  });

  it("does not consume a seed intended for another workbook", () => {
    useApp.setState({ originWorksheetSeed: { datasetId: "other", columns: [0] } });
    const { result } = renderHook(() => useWorksheetView(ds));
    expect(result.current.selectedCols.size).toBe(0);
    expect(useApp.getState().originWorksheetSeed?.datasetId).toBe("other");
  });
});

describe("useWorksheetView — plot-intent stage routing (item 1)", () => {
  it("plotSelection forces the Plot tab even when the dataset is already active (setActive never runs)", () => {
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.setColSelection([0]));
    act(() => result.current.plotSelection());
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("addSelectionToPlot forces the Plot tab too", () => {
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.setColSelection([0]));
    act(() => result.current.addSelectionToPlot());
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("plotSelection also rebinds + forces the Plot tab when the worksheet dataset ISN'T the active one", () => {
    useApp.setState({ activeId: "other", datasets: [ds, { ...ds, id: "other" }] });
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.setColSelection([0]));
    act(() => result.current.plotSelection());
    const s = useApp.getState();
    expect(s.activeId).toBe("d1");
    expect(s.stageTab).toBe("plot");
  });
});

describe("useWorksheetView — Open in Graph Builder (MAIN_PLAN #4)", () => {
  it("seeds the store with the selection's spec and opens the builder", () => {
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.setColSelection([0, 1]));
    act(() => result.current.openSelectionInGraphBuilder());
    const s = useApp.getState();
    expect(s.graphBuilderOpen).toBe(true);
    expect(s.graphBuilderSeed).toEqual({
      version: 1,
      zones: {
        x: { datasetId: "d1", channel: 0 },
        y: [{ datasetId: "d1", channel: 1 }],
        group: null,
        facet: null,
      },
      mark: "scatter",
    });
  });

  it("#8i: does NOT rebind the active dataset when the worksheet shows a non-active one", () => {
    useApp.setState({ activeId: "other", datasets: [ds, { ...ds, id: "other" }] });
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.openInGraphBuilder([1]));
    const s = useApp.getState();
    // Opening an overlay is not a plot intent: the plot/windows/view stay
    // put; the builder BINDS to the seed's dataset and its sendToStage lands
    // setActive when the user commits (see useGraphBuilder's #8i note).
    expect(s.activeId).toBe("other");
    expect(s.graphBuilderOpen).toBe(true);
    expect(s.graphBuilderSeed?.zones.y).toEqual([{ datasetId: "d1", channel: 1 }]);
  });

  it("an unplottable selection never opens the builder (status message instead)", () => {
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.openInGraphBuilder([-1])); // only the x/time column
    const s = useApp.getState();
    expect(s.graphBuilderOpen).toBe(false);
    expect(s.graphBuilderSeed).toBeNull();
    expect(s.status).toBe("nothing plottable in the selection");
  });

  it("row state is untouched by a handoff (the spec renders through rowstate.analysisData)", () => {
    useApp.setState({
      datasets: [{ ...ds, excludedRows: [1] }],
    });
    const withExclusion = useApp.getState().datasets[0];
    const { result } = renderHook(() => useWorksheetView(withExclusion));
    act(() => result.current.openInGraphBuilder([0, 1]));
    expect(useApp.getState().datasets[0].excludedRows).toEqual([1]);
  });
});

describe("useWorksheetView — per-column widths (MAIN_PLAN #3)", () => {
  it("setColWidth clamps into the sane range and stores per column", () => {
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.setColWidth(0, 240));
    act(() => result.current.setColWidth(1, 5)); // clamps up to the minimum
    expect(result.current.colWidths[0]).toBe(240);
    expect(result.current.colWidths[1]).toBeGreaterThan(5);
  });

  it("autofitCol derives a width from the column's rendered content", () => {
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.autofitCol(0));
    expect(result.current.colWidths[0]).toBeGreaterThan(0);
  });

  it("widths are session state, reset on a dataset switch", () => {
    const other = { ...ds, id: "d2" };
    useApp.setState({ datasets: [ds, other] });
    const { result, rerender } = renderHook(({ d }) => useWorksheetView(d), {
      initialProps: { d: ds },
    });
    act(() => result.current.setColWidth(0, 300));
    expect(result.current.colWidths[0]).toBe(300);
    rerender({ d: other });
    expect(result.current.colWidths).toEqual({});
  });
});

describe("useWorksheetView — window-scoped row selection (GUI_INTERACTION #14)", () => {
  it("two document windows on the SAME dataset select independently", () => {
    const a = renderHook(() => useWorksheetView(ds, "w1"));
    const b = renderHook(() => useWorksheetView(ds, "w2"));
    act(() => a.result.current.toggleRowSelected(0));
    act(() => b.result.current.toggleRowSelected(2));
    expect([...a.result.current.selected]).toEqual([0]);
    expect([...b.result.current.selected]).toEqual([2]);
    // Selecting more in `a` never touches `b`'s selection.
    act(() => a.result.current.toggleRowSelected(1));
    expect([...a.result.current.selected]).toEqual([0, 1]);
    expect([...b.result.current.selected]).toEqual([2]);
  });

  it("a document window's selection never touches the Stage tab's (no windowId) selection", () => {
    const stage = renderHook(() => useWorksheetView(ds));
    const doc = renderHook(() => useWorksheetView(ds, "w1"));
    act(() => doc.result.current.toggleRowSelected(0));
    expect([...doc.result.current.selected]).toEqual([0]);
    expect([...stage.result.current.selected]).toEqual([]);
    expect(useApp.getState().selection).toBeNull(); // the legacy singleton is untouched
  });

  it("plotLinked is true for the Stage tab showing the active dataset, false for a document window", () => {
    const stage = renderHook(() => useWorksheetView(ds));
    const doc = renderHook(() => useWorksheetView(ds, "w1"));
    expect(stage.result.current.plotLinked).toBe(true);
    expect(doc.result.current.plotLinked).toBe(false);
  });

  it("plotLinked is false for the Stage tab when it shows a non-active dataset (item 15 worksheetId override)", () => {
    const other = { ...ds, id: "d2" };
    useApp.setState({ datasets: [ds, other], activeId: "d2" }); // active plot is d2
    const stage = renderHook(() => useWorksheetView(ds)); // Stage tab showing d1 via worksheetId override
    expect(stage.result.current.plotLinked).toBe(false);
  });

  it("an unlinked worksheet's own row selection stays live (not swallowed by the plotLinked gate)", () => {
    const other = { ...ds, id: "d2" };
    useApp.setState({ datasets: [ds, other], activeId: "d2" });
    const stage = renderHook(() => useWorksheetView(ds));
    act(() => stage.result.current.toggleRowSelected(1));
    expect([...stage.result.current.selected]).toEqual([1]);
  });

  it("plotted-column emphasis (xKey/yKeys) is gated to null for an unlinked worksheet window", () => {
    // The focused plot shows d2's axes; a worksheet window bound to d1 must
    // never echo them as if they were ITS OWN plotted columns.
    const other = { ...ds, id: "d2" };
    useApp.setState({ datasets: [ds, other], activeId: "d2", xKey: 0, yKeys: [1] });
    const { result } = renderHook(() => useWorksheetView(ds, "w1"));
    expect(result.current.xKey).toBeNull();
    expect(result.current.yKeys).toBeNull();
  });

  it("setXKey on an unlinked worksheet claims the focused plot for its dataset first, then sets it", () => {
    const other = { ...ds, id: "d2" };
    useApp.setState({ datasets: [ds, other], activeId: "d2", stageTab: "plot" });
    const { result } = renderHook(() => useWorksheetView(ds, "w1")); // bound to d1, plot shows d2
    act(() => result.current.setXKey(1));
    const s = useApp.getState();
    expect(s.activeId).toBe("d1"); // claimed
    expect(s.xKey).toBe(1);
  });

  it("closing a document window's selection (clearWorksheetRowSelection) is reflected live in the hook", () => {
    const { result } = renderHook(() => useWorksheetView(ds, "w1"));
    act(() => result.current.toggleRowSelected(0));
    expect([...result.current.selected]).toEqual([0]);
    act(() => useApp.getState().clearWorksheetRowSelection("w1"));
    expect([...result.current.selected]).toEqual([]);
  });
});
