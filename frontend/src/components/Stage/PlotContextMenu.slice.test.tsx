// Item 22, the data slicer: after a Select rows drag, the plot's right-click menu acts
// on the rectangle (Keep only, Extract to a new sheet, Use the box as a data filter),
// through the real menu, store and the Data Filter / row-state paths.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import PlotContextMenu from "./PlotContextMenu";
import type { PlotPayload } from "../../lib/plotdata";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import type { PlotStageActions } from "./usePlotStageActions";

type Sel = { left: number; top: number; width: number; height: number };

// Pixel = data value (valToPos / posToVal identity); the plot area is 400 x 300 px.
function fakePlot(select: Sel): uPlot {
  return {
    over: { getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400 }), clientHeight: 300 },
    data: [[0, 100, 200, 300, 400], [10, 20, 150, 40, 50]],
    series: [{}, { scale: "y" }],
    scales: { x: { min: 0, max: 400 }, y: { min: 0, max: 300 } },
    select,
    posToVal: (px: number) => px,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

const actions = { resetView: vi.fn(), smartScale: vi.fn(), savePng: vi.fn(), copyData: vi.fn(), copyFigure: vi.fn(), snapshot: vi.fn() } as PlotStageActions;
// X = 0..4; A = 10, 20, 150, 40, 50; B = 5 x A.
const ds: Dataset = {
  id: "d", name: "d.csv",
  data: { time: [0, 1, 2, 3, 4], values: [[10, 50], [20, 100], [150, 750], [40, 200], [50, 250]], labels: ["A", "B"], units: ["", ""], metadata: {} },
};
const win: PlotWindow = {
  id: "w1", kind: "plot", title: "w1", datasetId: "d", geometry: { x: 0, y: 0, w: 300, h: 200 }, z: 0,
  winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
};
const BOX: Sel = { left: 1, top: 15, width: 2, height: 100 }; // x 1..3, y 15..115: rows 1 and 3 of A

function open(select: Sel) {
  const payload = { data: [[0, 100, 200, 300, 400], [10, 20, 150, 40, 50]], series: [{ label: "A", unit: "" }] } as unknown as PlotPayload;
  render(<PlotContextMenu x={300} y={380} plotRef={{ current: fakePlot(select) }} payload={payload} plotted={[0]} hidden={[false]} actions={actions} onClose={vi.fn()} />);
}

beforeEach(() => {
  useApp.setState({
    datasets: [ds], activeId: "d", selectedIds: [], selection: { datasetId: "d", rows: [1, 3] }, plotWindows: [win], focusedWindowId: "w1",
    plotTool: "select", xKey: null, yKeys: [0], y2Keys: null, hiddenChannels: [], seriesOrder: [], seriesStyles: {}, seriesLabels: {}, workbooks: [],
    history: [], future: [], status: "",
  });
});

const d0 = () => useApp.getState().datasets.find((d) => d.id === "d")!;

describe("data slicer entries", () => {
  it("offers nothing under another tool", () => {
    useApp.setState({ plotTool: "zoom" });
    open(BOX);
    expect(screen.queryByText(/Keep only selected points/)).toBeNull();
    expect(screen.queryByText(/as a data filter/)).toBeNull();
  });

  it("Keep only masks every row but the selected ones, one undo step", () => {
    open(BOX);
    fireEvent.click(screen.getByText("Keep only selected points (2)"));
    expect(d0().excludedRows).toEqual([0, 2, 4]);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(d0().excludedRows).toBeUndefined();
  });

  it("Create subset from region copies the selected rows beside the source, keeps the graph focused, and links the rows back", async () => {
    open(BOX);
    fireEvent.click(screen.getByText("Create subset from region (2 points)"));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    const sub = useApp.getState().datasets.find((d) => d.id !== "d")!;
    expect(sub.data.time).toEqual([1, 3]);
    expect(sub.data.values).toEqual([[20, 100], [40, 200]]);
    expect(d0().excludedRows).toBeUndefined();
    expect(useApp.getState().activeId).toBe("d"); // the graph keeps focus (quiet add)
    // The link: Go to Source selects exactly the source rows the region held.
    const { goToSourceRows } = await import("../../store/sourceRowLink");
    expect(goToSourceRows(sub.id)).toBe(true);
    expect([...(useApp.getState().selection?.rows ?? [])].sort()).toEqual([1, 3]); // the source is the active sheet: its linked selection
  });

  it("Extract skips a selected row that is masked, as the worksheet's Extract does", async () => {
    useApp.setState({ datasets: [{ ...ds, excludedRows: [3] }] });
    open(BOX);
    fireEvent.click(screen.getByText("Create subset from region (2 points)"));
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(2));
    expect(useApp.getState().datasets.find((d) => d.id !== "d")!.data.time).toEqual([1]);
  });

  it("Use the box as a data filter writes ordinary X and Y range predicates, which Undo removes", async () => {
    open(BOX);
    fireEvent.click(screen.getByText("Use the box as a data filter (X and Y)"));
    await waitFor(() => expect(d0().filter).toBeDefined());
    expect(d0().filter).toEqual([{ col: -1, kind: "range", min: 1, max: 3 }, { col: 0, kind: "range", min: 15, max: 115 }]);
    useApp.getState().undo();
    expect(d0().filter).toBeUndefined();
  });

  it("a box dragged the full height of the plot is an X band: only X is filtered", async () => {
    open({ left: 1, top: 0, width: 2, height: 300 });
    fireEvent.click(screen.getByText("Use the band as a data filter (X)"));
    await waitFor(() => expect(d0().filter).toBeDefined());
    expect(d0().filter).toEqual([{ col: -1, kind: "range", min: 1, max: 3 }]);
  });

  it("with two curves the Y window is not used, and the status says so", async () => {
    useApp.setState({ yKeys: [0, 1] });
    open(BOX);
    fireEvent.click(screen.getByText("Use the box as a data filter (X and Y)"));
    await waitFor(() => expect(d0().filter).toBeDefined());
    expect(d0().filter).toEqual([{ col: -1, kind: "range", min: 1, max: 3 }]);
    expect(useApp.getState().status).toMatch(/X window only: the Y window needs exactly one visible curve/);
  });

  it("keeps the sheet's other filters and replaces those on the same columns", async () => {
    useApp.setState({ datasets: [{ ...ds, filter: [{ col: 1, kind: "range", min: 0, max: 1000 }, { col: -1, kind: "range", min: 0, max: 4 }] }] });
    open(BOX);
    fireEvent.click(screen.getByText("Use the box as a data filter (X and Y)"));
    await waitFor(() => expect(d0().filter).toHaveLength(3));
    expect(d0().filter).toContainEqual({ col: 1, kind: "range", min: 0, max: 1000 });
    expect(d0().filter).toContainEqual({ col: -1, kind: "range", min: 1, max: 3 });
  });
});
