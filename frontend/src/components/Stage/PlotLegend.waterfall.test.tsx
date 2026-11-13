// Figures audit #19: series i is lifted i steps under a waterfall, so S0 is
// the BOTTOM trace — the legend listed it at the top. The legend is told how
// many rows the CANVAS staggered (`waterfallStaggeredRows` of the display
// payload), not the store's fraction, so it cannot reorder over a canvas that
// drew no stagger; `lib/waterfallLegendWireFixture.test.ts` pins the same
// order against the export.
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import PlotLegend from "./PlotLegend";
import type { PlotSeriesSpec } from "../../lib/plotdata";
import { applyWaterfall, buildColumns } from "../../lib/plotdata";
import { waterfallLegendOrder, waterfallStaggeredRows } from "../../lib/waterfallOffset";
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
    const { container, rerender } = render(<PlotLegend series={three} plotted={[0, 1, 2]} hidden={[false, false, false]} />);
    expect(rowTexts(container)).toEqual(["S0", "S1", "S2"]);
    rerender(<PlotLegend series={three} plotted={[0, 1, 2]} hidden={[false, false, false]} staggeredRows={3} />);
    expect(rowTexts(container)).toEqual(["S2", "S1", "S0"]);
  });

  it("the ▲ button still moves a row UP the list (later in draw order under a waterfall)", () => {
    const { container } = render(<PlotLegend series={three} plotted={[0, 1, 2]} hidden={[false, false, false]} staggeredRows={3} />);
    const bottomRow = [...container.querySelectorAll(".qzk-legend .it")].at(-1)!; // S0, the bottom trace
    const up = [...bottomRow.querySelectorAll("button")].find((b) => b.textContent === "▲")!;
    expect(up).toHaveAccessibleName("Move later");
    fireEvent.click(up);
    expect(useApp.getState().seriesOrder).toEqual([1, 0, 2]);
  });

  it("orders only the staggered rows; overlay rows after them keep their place", () => {
    expect(waterfallLegendOrder(5, 3)).toEqual([2, 1, 0, 3, 4]);
    expect(waterfallLegendOrder(3, 0)).toEqual([0, 1, 2]);
    expect(waterfallLegendOrder(3, 1)).toEqual([0, 1, 2]); // one lifted row is no reorder
  });

  it("a waterfall fraction over a canvas that staggered nothing leaves draw order alone", () => {
    // The store can hold a fraction the canvas refuses (an encoded view) or
    // never applies (a lone series): the legend follows what was DRAWN.
    useApp.setState({ waterfall: 0.4 });
    const { container } = render(<PlotLegend series={three} plotted={[0, 1, 2]} hidden={[false, false, false]} />);
    expect(rowTexts(container)).toEqual(["S0", "S1", "S2"]);
  });

  it("counts the staggered rows off the display payload", () => {
    const data = { time: [0, 1], values: [[1, 2, 3], [4, 5, 6]], labels: ["a", "b", "c"], units: ["", "", ""], metadata: {} };
    const base = buildColumns(data, null, null, [0, 1, 2]);
    expect(waterfallStaggeredRows(base)).toBe(0);
    expect(waterfallStaggeredRows(applyWaterfall(base, 0.25))).toBe(3);
    const one = buildColumns(data, null, null, [0]);
    expect(waterfallStaggeredRows(applyWaterfall(one, 0.25))).toBe(0); // a lone series is never staggered
    expect(waterfallStaggeredRows(null)).toBe(0);
  });
});
