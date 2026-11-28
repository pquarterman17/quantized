// Item 22: the axis scroller on a probability axis and on a Y3+ axis, through the real panel and store. Each moves
// the window in the axis' own coordinates and is ONE Back-view step.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import GraphBrowserPanel from "./GraphBrowserPanel";

// X 1..10; P = 0.01, 0.1, 0.2 ... 0.8, 0.99 (a fraction); Q = 100 X (on Y3).
const P = [0.01, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.99];
const sheet: Dataset = {
  id: "a", name: "Sa",
  data: { time: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], values: P.map((p, i) => [p, 100 * (i + 1)]), labels: ["P", "Q"], units: ["", ""], metadata: {} },
};
const extra = { lim: [200, 400] as [number, number], scale: null, step: null, fmt: null, label: "", color: null };

beforeEach(() => {
  useApp.setState({
    datasets: [sheet], activeId: "a", selectedIds: [], history: [], future: [], viewHistory: [], viewFuture: [],
    xKey: null, yKeys: [0], y2Keys: null, hiddenChannels: [], seriesOrder: [], seriesStyles: {}, seriesLabels: {}, workbooks: [],
    xLim: null, yLim: null, y2Lim: null, xScale: "linear", yScale: "linear", y2Scale: null, exchangeXY: false, plotTool: "pointer",
    yAxes: [], yAxisOf: {},
    yFmt: { mode: "auto", digits: 2 }, y2Fmt: null,
  });
});

const scrollTo = (axis: string, value: number) => {
  fireEvent.click(screen.getByRole("button", { name: /Scroll an axis/ }));
  const slider = screen.getByLabelText(`Scroll the ${axis} axis`) as HTMLInputElement;
  expect(slider.disabled).toBe(false);
  fireEvent.change(slider, { target: { value: String(value) } });
  fireEvent.pointerUp(slider);
};

describe("axis scroller, probability and Y3+ axes", () => {
  it("scrolls a probability Y axis in quantiles", () => {
    useApp.setState({ yFmt: { mode: "auto", digits: 2, prob: "fraction" }, yLim: [0.4, 0.6] });
    render(<GraphBrowserPanel />);
    scrollTo("Y", 0);
    const [lo, hi] = useApp.getState().yLim as [number, number];
    expect(lo).toBeCloseTo(0.01, 12); // scipy: norm.cdf(ppf(0.01) + (ppf(0.6) - ppf(0.4))) = 0.0344059
    expect(hi).toBeCloseTo(0.03440588162805031, 12);
    expect(useApp.getState().viewHistory).toHaveLength(1);
    useApp.getState().backView();
    expect(useApp.getState().yLim).toEqual([0.4, 0.6]);
  });

  it("without the probability setting the same data scrolls linearly", () => {
    useApp.setState({ yLim: [0.4, 0.6] });
    render(<GraphBrowserPanel />);
    scrollTo("Y", 0);
    const [lo, hi] = useApp.getState().yLim as [number, number];
    expect(lo).toBeCloseTo(0.01, 12);
    expect(hi).toBeCloseTo(0.21, 12);
  });

  it("scrolls a Y3 axis against the curves drawn on it, as one Back-view step", () => {
    useApp.setState({ yKeys: [0, 1], yAxes: [extra], yAxisOf: { 1: 3 }, yLim: [0.2, 0.4], xLim: [2, 4] });
    render(<GraphBrowserPanel />);
    scrollTo("Y3", 1000);
    expect(useApp.getState().yAxes[0].lim).toEqual([800, 1000]); // Q spans 100..1000 and the window keeps its width 200
    expect(useApp.getState().yLim).toEqual([0.2, 0.4]);
    expect(useApp.getState().xLim).toEqual([2, 4]);
    expect(useApp.getState().viewHistory).toHaveLength(1);
    useApp.getState().backView();
    expect(useApp.getState().yAxes[0].lim).toEqual([200, 400]);
  });

  it("offers no Y3 scroller when no visible curve is on it", () => {
    useApp.setState({ yKeys: [0], yAxes: [extra], yAxisOf: { 1: 3 } });
    render(<GraphBrowserPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Scroll an axis/ }));
    expect(screen.queryByLabelText("Scroll the Y3 axis")).toBeNull();
  });
});
