import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import PlotContextMenu from "./PlotContextMenu";
import type { PlotPayload } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";
import type { PlotStageActions } from "./usePlotStageActions";

// A minimal fake uPlot: the plot rect is [100,100]→[500,400] and posToVal /
// valToPos are identity, so a click at client (300,250) probes localX=200
// (x-index 2 of the column below) and localY=150.
function fakePlot(): uPlot {
  return {
    over: {
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 }),
    },
    data: [
      [0, 100, 200, 300, 400],
      [10, 20, 150, 40, 50], // series 0 → y=150 at idx 2 (nearest to the cursor)
      [10, 20, 300, 40, 50], // series 1 → y=300 at idx 2 (far)
    ],
    series: [{}, { scale: "y" }, { scale: "y" }],
    scales: { x: { min: 0, max: 400 }, y: { min: 0, max: 300 } },
    posToVal: (px: number) => px,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

const payload = {
  series: [
    { label: "A", unit: "" },
    { label: "B", unit: "" },
  ],
} as unknown as PlotPayload;

const actions: PlotStageActions = {
  resetView: vi.fn(),
  smartScale: vi.fn(),
  savePng: vi.fn(),
  copyData: vi.fn(),
  snapshot: vi.fn(),
};

beforeEach(() => {
  useApp.setState({
    seriesStyles: {},
    seriesLabels: {},
    hiddenChannels: [],
    y2Keys: null,
    showGrid: true,
    showLegend: true,
    legendPos: "ne",
    xLog: false,
    yLog: false,
  });
});

function open(onClose = vi.fn()) {
  render(
    <PlotContextMenu
      x={300}
      y={250}
      plotRef={{ current: fakePlot() }}
      payload={payload}
      plotted={[0, 1]}
      hidden={[false, false]}
      actions={actions}
      onClose={onClose}
    />,
  );
  return onClose;
}

describe("PlotContextMenu", () => {
  it("opens with the hit-tested series header + colour swatches", () => {
    open();
    // The nearest curve at the cursor is display-series 0 → label "A".
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByTitle("Series 1")).toBeInTheDocument();
    // Axis + plot sections are always present.
    expect(screen.getByText("X axis")).toBeInTheDocument();
    expect(screen.getByText("Reset view (autoscale)")).toBeInTheDocument();
  });

  it("a colour swatch dispatches setSeriesStyle for the hit-tested channel", () => {
    const onClose = open();
    fireEvent.click(screen.getByTitle("Series 3"));
    expect(useApp.getState().seriesStyles[0]?.color).toBe("--series-3");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("a plot entry dispatches its existing store action", () => {
    open();
    // showGrid starts true → the entry reads "Hide grid".
    fireEvent.click(screen.getByText("Hide grid"));
    expect(useApp.getState().showGrid).toBe(false);
  });

  it("opens a submenu flyout on hover and dispatches a leaf action", () => {
    open();
    fireEvent.mouseEnter(screen.getByText("Width").closest(".qzk-ctx-subwrap")!);
    fireEvent.click(screen.getByText("2 px"));
    expect(useApp.getState().seriesStyles[0]?.width).toBe(2);
  });
});
