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

  it("rebinds the active dataset first when the worksheet shows a non-active one", () => {
    useApp.setState({ activeId: "other", datasets: [ds, { ...ds, id: "other" }] });
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.openInGraphBuilder([1]));
    const s = useApp.getState();
    expect(s.activeId).toBe("d1"); // the Graph Builder reads the ACTIVE dataset
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
