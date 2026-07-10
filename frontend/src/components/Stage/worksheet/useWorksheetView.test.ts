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
