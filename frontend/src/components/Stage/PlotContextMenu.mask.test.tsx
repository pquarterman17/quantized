// Gap audit 2 #7: after a Select Rows brush, the plot's right-click menu
// excludes / re-includes those points through the worksheet's own row
// exclusion, so the change is one undo step and every consumer follows.
// Gap audit 2 #8: a curve's menu has Plot Details.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import PlotContextMenu from "./PlotContextMenu";
import type { PlotPayload } from "../../lib/plotdata";
import type { Dataset } from "../../lib/types";
import { useFigureDialog } from "../../store/figureDialogs";
import { useApp } from "../../store/useApp";
import type { PlotStageActions } from "./usePlotStageActions";

function fakePlot(): uPlot {
  return {
    over: { getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400 }) },
    data: [[0, 100, 200, 300, 400], [10, 20, 150, 40, 50]],
    series: [{}, { scale: "y" }],
    scales: { x: { min: 0, max: 400 }, y: { min: 0, max: 300 } },
    posToVal: (px: number) => px,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

const payload = { series: [{ label: "A", unit: "" }] } as unknown as PlotPayload;
const actions = {
  resetView: vi.fn(), smartScale: vi.fn(), savePng: vi.fn(), copyData: vi.fn(), copyFigure: vi.fn(), snapshot: vi.fn(),
} as PlotStageActions;
const ds: Dataset = {
  id: "d", name: "d.csv",
  data: { time: [0, 1, 2, 3, 4], values: [[10], [20], [150], [40], [50]], labels: ["A"], units: [""], metadata: {} },
};

function open(y = 250) {
  render(
    <PlotContextMenu
      x={300} y={y} plotRef={{ current: fakePlot() }} payload={payload} plotted={[0]} hidden={[false]}
      actions={actions} onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({
    datasets: [ds], activeId: "d", selection: { datasetId: "d", rows: [2, 3] },
    seriesStyles: {}, seriesLabels: {}, hiddenChannels: [], y2Keys: null, history: [], future: [],
  });
});

describe("PlotContextMenu: masking brushed points (#7)", () => {
  it("Exclude selected points excludes the brushed rows as one undo step", () => {
    open(380); // empty plot area: no curve header
    fireEvent.click(screen.getByText("Exclude selected points (2)"));
    expect(useApp.getState().datasets[0].excludedRows).toEqual([2, 3]);
    expect(useApp.getState().selection).toBeNull();
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().datasets[0].excludedRows).toBeUndefined();
  });

  it("Include selected points re-includes only the brushed rows", () => {
    useApp.setState({ datasets: [{ ...ds, excludedRows: [1, 2, 3] }] });
    open(380);
    fireEvent.click(screen.getByText("Include selected points"));
    expect(useApp.getState().datasets[0].excludedRows).toEqual([1]);
  });

  it("Include all points clears every exclusion", () => {
    useApp.setState({ datasets: [{ ...ds, excludedRows: [1, 4] }], selection: null });
    open(380);
    expect(screen.queryByText(/Exclude selected points/)).toBeNull();
    fireEvent.click(screen.getByText("Include all points (2)"));
    expect(useApp.getState().datasets[0].excludedRows).toBeUndefined();
  });
});

describe("PlotContextMenu: Plot Details (#8)", () => {
  it("the curve's Plot Details… opens the dialog on its channel", () => {
    open(250); // on the curve
    fireEvent.click(screen.getByText("Plot Details…"));
    expect(useFigureDialog.getState().open).toEqual({ kind: "plotDetails", channel: 0 });
  });
});
