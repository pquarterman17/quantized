// Item 22: the axis scroller on a reciprocal axis, the Y2 axis and an exchanged
// (turned) plot, through the real panel and store. Each moves the window in the
// axis' own coordinates and is ONE Back-view step.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import GraphBrowserPanel from "./GraphBrowserPanel";

// X 1..10, P = X, Q = 100 X: so every axis has a known extent.
const sheet: Dataset = {
  id: "a", name: "Sa",
  data: { time: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], values: Array.from({ length: 10 }, (_, i) => [i + 1, 100 * (i + 1)]), labels: ["P", "Q"], units: ["", ""], metadata: {} },
};

beforeEach(() => {
  useApp.setState({
    datasets: [sheet], activeId: "a", selectedIds: [], history: [], future: [], viewHistory: [], viewFuture: [],
    xKey: null, yKeys: [0], y2Keys: null, hiddenChannels: [], seriesOrder: [], seriesStyles: {}, seriesLabels: {}, workbooks: [],
    xLim: null, yLim: null, y2Lim: null, xScale: "linear", yScale: "linear", y2Scale: null, exchangeXY: false, plotTool: "pointer",
  });
});

const scrollTo = (axis: string, value: number) => {
  fireEvent.click(screen.getByRole("button", { name: /Scroll an axis/ }));
  const slider = screen.getByLabelText(`Scroll the ${axis} axis`) as HTMLInputElement;
  expect(slider.disabled).toBe(false);
  fireEvent.change(slider, { target: { value: String(value) } });
  fireEvent.pointerUp(slider);
};

describe("axis scroller, other axis kinds", () => {
  it("scrolls a reciprocal X axis in 1/x: the slider at the left gives the lowest X", () => {
    useApp.setState({ xScale: "reciprocal", xLim: [2, 4] });
    render(<GraphBrowserPanel />);
    scrollTo("X", 0);
    const [lo, hi] = useApp.getState().xLim as [number, number];
    expect(lo).toBeCloseTo(1, 12);
    expect(hi).toBeCloseTo(4 / 3, 12); // the window keeps its width 0.25 in 1/x: 1 / (1 - 0.25)
    expect(useApp.getState().viewHistory).toHaveLength(1);
    useApp.getState().backView();
    expect(useApp.getState().xLim).toEqual([2, 4]);
  });

  it("scrolls the Y2 axis against the Y2 curves' own extent, leaving X and Y alone, as one Back-view step", () => {
    useApp.setState({ yKeys: [0, 1], y2Keys: [1], y2Lim: [200, 400], yLim: [2, 4], xLim: [2, 4] });
    render(<GraphBrowserPanel />);
    scrollTo("Y2", 1000);
    expect(useApp.getState().y2Lim).toEqual([800, 1000]); // Q spans 100..1000 and the window keeps its width 200
    expect(useApp.getState().yLim).toEqual([2, 4]);
    expect(useApp.getState().xLim).toEqual([2, 4]);
    expect(useApp.getState().viewHistory).toHaveLength(1);
    useApp.getState().backView();
    expect(useApp.getState().y2Lim).toEqual([200, 400]);
  });

  it("scrolls the primary Y over the primary curves only when a curve is on Y2", () => {
    useApp.setState({ yKeys: [0, 1], y2Keys: [1], yLim: [2, 4], y2Lim: [200, 400] });
    render(<GraphBrowserPanel />);
    scrollTo("Y", 1000);
    expect(useApp.getState().yLim).toEqual([8, 10]); // P spans 1..10, not Q's 100..1000
  });

  it("offers no Y2 scroller without a Y2 axis", () => {
    render(<GraphBrowserPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Scroll an axis/ }));
    expect(screen.queryByLabelText("Scroll the Y2 axis")).toBeNull();
  });

  it("scrolls an exchanged (turned) plot: the limits stay with their own axis", () => {
    useApp.setState({ exchangeXY: true, xLim: [2, 4], yLim: [20, 40] });
    render(<GraphBrowserPanel />);
    scrollTo("X", 1000);
    expect(useApp.getState().xLim).toEqual([8, 10]); // X is still the data's X, only drawn up the side
    expect(useApp.getState().yLim).toEqual([20, 40]);
    expect(useApp.getState().viewHistory).toHaveLength(1);
  });
});
