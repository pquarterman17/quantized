// Gap audit 3 N2: right-click a data point to mask it, or a masked point to
// unmask it (one undo step, the worksheet's own row exclusion). N1/N3: the
// plot menu opens Layer Contents and offers "Link X axis with…" once there is
// another graph window to link with.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import PlotContextMenu from "./PlotContextMenu";
import type { PlotPayload } from "../../lib/plotdata";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useFigureDialog } from "../../store/figureDialogs";
import { useApp } from "../../store/useApp";
import type { PlotStageActions } from "./usePlotStageActions";

// Pixel = data value (valToPos identity); the plot's origin is client (100, 100).
function fakePlot(ghost?: (number | null)[]): uPlot {
  return {
    over: { getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400 }) },
    data: [[0, 100, 200, 300, 400], [10, 20, 150, 40, 50], ...(ghost ? [ghost] : [])],
    series: [{}, { scale: "y" }, ...(ghost ? [{ scale: "y" }] : [])],
    scales: { x: { min: 0, max: 400 }, y: { min: 0, max: 300 } },
    posToVal: (px: number) => px,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

const actions = {
  resetView: vi.fn(), smartScale: vi.fn(), savePng: vi.fn(), copyData: vi.fn(), copyFigure: vi.fn(), snapshot: vi.fn(),
} as PlotStageActions;
const ds: Dataset = {
  id: "d", name: "d.csv",
  data: { time: [0, 1, 2, 3, 4], values: [[10], [20], [150], [40], [50]], labels: ["A"], units: [""], metadata: {} },
};
const win = (id: string): PlotWindow => ({
  id, kind: "plot", title: id, datasetId: "d", geometry: { x: 0, y: 0, w: 300, h: 200 }, z: 0,
  winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
});

function open(x: number, y: number, ghost?: (number | null)[], extra: Partial<PlotPayload> = {}) {
  const payload = {
    data: [[0, 100, 200, 300, 400], [10, 20, 150, 40, 50], ...(ghost ? [ghost] : [])],
    series: [{ label: "A", unit: "" }, ...(ghost ? [{ label: "A (excluded)", unit: "", kind: "points", muted: true }] : [])],
    ...extra,
  } as unknown as PlotPayload;
  render(
    <PlotContextMenu
      x={x} y={y} plotRef={{ current: fakePlot(ghost) }} payload={payload} plotted={[0]} hidden={[false]}
      actions={actions} onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({
    datasets: [ds], activeId: "d", selection: null, plotWindows: [win("w1")], focusedWindowId: "w1",
    seriesStyles: {}, seriesLabels: {}, hiddenChannels: [], y2Keys: null, history: [], future: [],
  });
});

describe("PlotContextMenu: mask one point (N2)", () => {
  it("right-clicking a point masks just that row, as one undo step", () => {
    open(300 + 3, 250 - 2); // 3 px off the point at data (200, 150) = row 3
    fireEvent.click(screen.getByText("Mask this point (row 3)"));
    expect(useApp.getState().datasets[0].excludedRows).toEqual([2]);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().datasets[0].excludedRows).toBeUndefined();
  });

  it("right-clicking a masked (greyed) point unmasks it", () => {
    useApp.setState({ datasets: [{ ...ds, excludedRows: [2, 4] }] });
    open(300, 250, [null, null, 150, null, 50]);
    fireEvent.click(screen.getByText("Unmask this point (row 3)"));
    expect(useApp.getState().datasets[0].excludedRows).toEqual([4]);
  });

  it("on a decimated plot with no row map the point is refused, never guessed (review #1)", () => {
    open(300, 250, undefined, { decimated: true });
    expect(screen.getByText(/Can't mask this point/)).toBeInTheDocument();
    expect(screen.queryByText(/Mask this point \(row/)).toBeNull();
  });

  it("a point hidden by a filter offers no unmask: it names the filter (review #9)", () => {
    useApp.setState({ datasets: [{ ...ds, filter: [{ col: 0, kind: "range", min: 0, max: 100 }] }] });
    open(300, 250, [null, null, 150, null, null]);
    expect(screen.queryByText(/Unmask this point/)).toBeNull();
    expect(screen.getByText(/hidden by the “A” filter of “d.csv”/)).toBeInTheDocument();
  });

  it("no point entry away from every point", () => {
    open(300, 380);
    expect(screen.queryByText(/this point/)).toBeNull();
  });
});

describe("PlotContextMenu: Layer Contents (N1) and Link X axis (N3)", () => {
  it("Layer Contents… opens the dialog", () => {
    open(300, 380);
    fireEvent.click(screen.getByText("Layer Contents…"));
    expect(useFigureDialog.getState().open).toEqual({ kind: "layerContents" });
  });

  it("Link X axis with… is offered only with another graph window", () => {
    open(300, 380);
    expect(screen.queryByText("Link X axis with…")).toBeNull();
  });

  it("…and appears once there is one", () => {
    useApp.setState({ plotWindows: [win("w1"), win("w2")] });
    open(300, 380);
    expect(screen.getByText("Link X axis with…")).toBeInTheDocument();
  });
});
