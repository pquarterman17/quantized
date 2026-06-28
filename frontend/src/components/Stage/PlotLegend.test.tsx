import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import PlotLegend from "./PlotLegend";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";

const series: PlotSeriesSpec[] = [
  { label: "A", unit: "" },
  { label: "B", unit: "" },
];

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
