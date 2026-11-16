// Double-clicking an axis gutter on a TURNED plot (horizontal bars / Exchange
// X-Y) opens the axis that is drawn there: the bottom gutter now carries Y, the
// left one X, and Y2 sits across the top.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFigureDialog } from "../../store/figureDialogs";
import { axisAtPoint, openAxisAt, topAxisTops } from "./axisAtPoint";
import { useApp } from "../../store/useApp";

const over = { left: 100, right: 500, top: 50, bottom: 300 };
const root = { left: 0, right: 560, top: 0, bottom: 360 };

beforeEach(() => useFigureDialog.setState({ open: null }));

describe("axisAtPoint turned", () => {
  it("bottom = Y, left = X, top = Y2 (only when drawn), right = nothing", () => {
    expect(axisAtPoint(over, root, 300, 330, true, true)).toBe("y");
    expect(axisAtPoint(over, root, 60, 150, true, true)).toBe("x");
    expect(axisAtPoint(over, root, 300, 20, true, true)).toBe("y2");
    expect(axisAtPoint(over, root, 300, 20, false, true)).toBeNull();
    expect(axisAtPoint(over, root, 540, 150, true, true)).toBeNull();
  });
  it("upright is as before", () => {
    expect(axisAtPoint(over, root, 300, 330, true)).toBe("x");
    expect(axisAtPoint(over, root, 60, 150, true)).toBe("y");
  });
});

describe("openAxisAt on an exchanged graph", () => {
  it("the left axis (X) opens the X dialog, the bottom one (Y) the Y dialog", () => {
    openAxisAt(over, root, 60, 150, false, [], true);
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "x" });
    openAxisAt(over, root, 300, 330, false, [], true);
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "y" });
  });
  it("and upright is as before", () => {
    openAxisAt(over, root, 60, 150, false, []);
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "y" });
  });
});

const ask = vi.hoisted(() => vi.fn());
vi.mock("../../store/paramDialog", () => ({ askParams: ask }));

describe("Y3+ axes across the top of a turned plot (horizontal bars)", () => {
  const axis = { lim: null, scale: null, step: null, fmt: null, label: "", color: null };
  const topOver = { left: 100, right: 500, top: 200, bottom: 400 };
  const topRoot = { left: 0, right: 560, top: 0, bottom: 460 };
  beforeEach(() => {
    ask.mockReset().mockResolvedValue(null);
    useApp.setState({
      datasets: [{ id: "d", name: "d", data: { time: [0, 1], values: [[1, 2, 3, 4], [2, 3, 4, 5]], labels: ["A", "B", "C", "D"], units: ["", "", "", ""], metadata: {} } }],
      activeId: "d", xKey: null, yKeys: [0, 1, 2, 3], seriesOrder: null, hiddenChannels: [],
      y2Keys: [1], yAxes: [axis, axis], yAxisOf: { 2: 3, 3: 4 },
    });
  });
  it("reads the drawn top axes nearest the plot first", () => {
    const chart = document.createElement("div");
    for (const [top, bottom] of [[150, 200], [100, 150], [50, 100], [210, 400]]) {
      const el = chart.appendChild(document.createElement("div"));
      el.className = "u-axis";
      el.getBoundingClientRect = () => ({ top, bottom, height: bottom - top }) as DOMRect;
    }
    expect(topAxisTops(chart, 200)).toEqual([150, 100, 50]); // the one beside the plot (Y1's) is not a top axis
  });
  it("the innermost top axis is Y2; further up, that axis' own settings", () => {
    openAxisAt(topOver, topRoot, 300, 170, true, [150, 100, 50], true);
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "y2" });
    openAxisAt(topOver, topRoot, 300, 60, true, [150, 100, 50], true);
    expect(ask.mock.calls.at(-1)![0]).toBe("Y4 Axis");
  });
});
