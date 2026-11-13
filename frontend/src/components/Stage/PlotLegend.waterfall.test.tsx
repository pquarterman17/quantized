// Figures audit #19: series i is lifted i steps under a waterfall, so S0 is
// the BOTTOM trace — the legend listed it at the top.
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import PlotLegend from "./PlotLegend";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import { waterfallLegendOrder } from "../../lib/waterfallOffset";
import { useApp } from "../../store/useApp";

const three: PlotSeriesSpec[] = [{ label: "S0", unit: "" }, { label: "S1", unit: "" }, { label: "S2", unit: "" }];
const rowTexts = (container: HTMLElement) =>
  [...container.querySelectorAll(".qzk-legend .it")].map((row) => row.textContent?.replace(/[▲▼]/g, ""));

beforeEach(() => {
  useApp.setState({
    hiddenChannels: [], seriesLabels: {}, y2Keys: null, legendPos: "ne", legendXY: null, legendSize: null,
    legendFrameXY: null, legendStatic: false, legendTitle: null, plotTool: "pointer", seriesOrder: null,
  });
});
afterEach(() => useApp.setState({ waterfall: 0, seriesOrder: null }));

describe("PlotLegend — waterfall row order", () => {
  it("lists the top trace first under a waterfall, in draw order otherwise", () => {
    useApp.setState({ waterfall: 0 });
    const { container, rerender } = render(<PlotLegend series={three} plotted={[0, 1, 2]} hidden={[false, false, false]} />);
    expect(rowTexts(container)).toEqual(["S0", "S1", "S2"]);
    useApp.setState({ waterfall: 0.4 });
    rerender(<PlotLegend series={three} plotted={[0, 1, 2]} hidden={[false, false, false]} />);
    expect(rowTexts(container)).toEqual(["S2", "S1", "S0"]);
  });

  it("the ▲ button still moves a row UP the list (later in draw order under a waterfall)", () => {
    useApp.setState({ waterfall: 0.4 });
    const { container } = render(<PlotLegend series={three} plotted={[0, 1, 2]} hidden={[false, false, false]} />);
    const bottomRow = [...container.querySelectorAll(".qzk-legend .it")].at(-1)!; // S0, the bottom trace
    const up = [...bottomRow.querySelectorAll("button")].find((b) => b.textContent === "▲")!;
    expect(up).toHaveAccessibleName("Move later");
    fireEvent.click(up);
    expect(useApp.getState().seriesOrder).toEqual([1, 0, 2]);
  });

  it("orders only the channel rows; overlay rows after them keep their place", () => {
    expect(waterfallLegendOrder(5, 3, 0.2)).toEqual([2, 1, 0, 3, 4]);
    expect(waterfallLegendOrder(3, 3, 0)).toEqual([0, 1, 2]);
  });
});
