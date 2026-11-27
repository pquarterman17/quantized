// Acceptance 7 B1: the row selection a Select rows drag makes rebuilds the uPlot, which
// wipes the painted box (.u-select is 0 x 0 a moment later). The slicer entries must
// still be offered, from the box captured in DATA coordinates when the drag ended.

import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import PlotContextMenu from "./PlotContextMenu";
import { usePlotStageActions } from "./usePlotStageActions";
import type { PlotStageActions } from "./usePlotStageActions";
import type { PlotPayload } from "../../lib/plotdata";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { rememberedSliceBox } from "../../lib/sliceBoxMemory";
import { useApp } from "../../store/useApp";

const X = [0, 100, 200, 300, 400];
const Y = [10, 20, 150, 40, 50];
const payload = { data: [X, Y], series: [{ label: "A", unit: "" }] } as unknown as PlotPayload;
// The rebuilt plot: nothing painted any more.
const rebuilt = {
  over: { getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400 }), clientHeight: 300 },
  data: [X, Y], series: [{}, { scale: "y" }], scales: { x: { min: 0, max: 400 }, y: { min: 0, max: 300 } },
  select: { left: 0, top: 0, width: 0, height: 0 },
  posToVal: (px: number) => px, valToPos: (v: number) => v,
} as unknown as uPlot;
const ds: Dataset = {
  id: "d", name: "d.csv",
  data: { time: X, values: Y.map((v) => [v]), labels: ["A"], units: [""], metadata: {} },
};
const win: PlotWindow = {
  id: "w1", kind: "plot", title: "w1", datasetId: "d", geometry: { x: 0, y: 0, w: 300, h: 200 }, z: 0,
  winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
};
const actions = { resetView: vi.fn(), smartScale: vi.fn(), savePng: vi.fn(), copyData: vi.fn(), copyFigure: vi.fn(), snapshot: vi.fn() } as PlotStageActions;

function openMenu() {
  render(<PlotContextMenu x={300} y={380} plotRef={{ current: rebuilt }} payload={payload} plotted={[0]} hidden={[false]} actions={actions} onClose={vi.fn()} />);
}
const d0 = () => useApp.getState().datasets.find((d) => d.id === "d")!;

beforeEach(() => {
  useApp.setState({
    datasets: [ds], activeId: "d", selectedIds: [], selection: null, plotWindows: [win], focusedWindowId: "w1",
    plotTool: "select", xKey: null, yKeys: [0], y2Keys: null, hiddenChannels: [], seriesOrder: [], seriesStyles: {}, seriesLabels: {}, workbooks: [],
    history: [], future: [], status: "",
  });
});

describe("data slicer after the selection rebuilt the plot", () => {
  it("offers the box filter, with the dragged bounds", async () => {
    const { result } = renderHook(() => usePlotStageActions({ current: rebuilt }, payload, ds, undefined, [0]));
    result.current.onRangeSelect(50, 250, [15, 160]); // the drag ends
    await waitFor(() => expect(rememberedSliceBox()).not.toBeNull());
    expect(useApp.getState().selection?.rows).toEqual([1, 2]);
    openMenu();
    fireEvent.click(screen.getByText("Use the box as a data filter (X and Y)"));
    await waitFor(() => expect(d0().filter).toBeDefined());
    expect(d0().filter).toEqual([{ col: -1, kind: "range", min: 50, max: 250 }, { col: 0, kind: "range", min: 15, max: 160 }]);
  });

  it("offers the band variant for a full-height drag", async () => {
    const { result } = renderHook(() => usePlotStageActions({ current: rebuilt }, payload, ds, undefined, [0]));
    result.current.onRangeSelect(50, 250);
    await waitFor(() => expect(rememberedSliceBox()).not.toBeNull());
    expect(useApp.getState().selection?.rows).toEqual([1, 2]);
    openMenu();
    expect(screen.getByText("Use the band as a data filter (X)")).toBeTruthy();
  });

  it("is not offered once the selection changes by another route", async () => {
    const { result } = renderHook(() => usePlotStageActions({ current: rebuilt }, payload, ds, undefined, [0]));
    result.current.onRangeSelect(50, 250, [15, 160]);
    await waitFor(() => expect(rememberedSliceBox()).not.toBeNull());
    expect(useApp.getState().selection?.rows).toEqual([1, 2]);
    useApp.getState().setRowSelection([4]);
    openMenu();
    expect(screen.queryByText(/as a data filter/)).toBeNull();
  });

  it("is not offered when nothing was dragged", () => {
    openMenu();
    expect(screen.queryByText(/as a data filter/)).toBeNull();
  });
});
