import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PlotLegend from "./PlotLegend";
import { CHANNEL_DND, decodeChannelDrag } from "../../lib/dragaxis";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";

const series: PlotSeriesSpec[] = [
  { label: "A", unit: "" },
  { label: "B", unit: "" },
];

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [[1, 2], [2, 3], [3, 4]],
  labels: ["A", "B"],
  units: ["", ""],
  metadata: {},
};

beforeEach(() => {
  useApp.setState({ hiddenChannels: [], seriesLabels: {}, y2Keys: null, legendPos: "ne" });
});

describe("PlotLegend position", () => {
  it("applies the store legend-position class", () => {
    const { container, rerender } = render(
      <PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />,
    );
    expect(container.querySelector(".qzk-legend")).toHaveClass("ne");

    useApp.setState({ legendPos: "sw" });
    rerender(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    expect(container.querySelector(".qzk-legend")).toHaveClass("sw");
  });
});

describe("PlotLegend drag-to-axis (#49)", () => {
  it("makes a channel entry draggable and encodes the CHANNEL_DND payload on dragstart", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run", data: DATA }], activeId: "d1" });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const items = container.querySelectorAll(".qzk-legend .it");
    expect(items[0]).toHaveAttribute("draggable", "true");

    const setData = vi.fn();
    fireEvent.dragStart(items[0], { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledTimes(1);
    const [type, raw] = setData.mock.calls[0] as [string, string];
    expect(type).toBe(CHANNEL_DND);
    expect(decodeChannelDrag(raw)).toEqual({ datasetId: "d1", channel: 0 });
  });

  it("is not draggable when there's no active dataset", () => {
    useApp.setState({ datasets: [], activeId: null });
    const { container } = render(<PlotLegend series={series} plotted={[0, 1]} hidden={[false, false]} />);
    const items = container.querySelectorAll(".qzk-legend .it");
    expect(items[0]).toHaveAttribute("draggable", "false");
  });
});
