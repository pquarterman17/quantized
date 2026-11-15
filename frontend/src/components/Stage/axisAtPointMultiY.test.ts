// Review L3 (gap audit 4 G11): double-clicking a right-hand axis of a graph
// with Y3+ axes opens THAT axis -- Y2's Axis dialog for the innermost when Y2
// is drawn, a Y3+ axis' own settings further out -- never Y2's for all.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApp } from "../../store/useApp";
import { useFigureDialog } from "../../store/figureDialogs";
import { openAxisAt, rightAxisLefts } from "./axisAtPoint";

const ask = vi.hoisted(() => vi.fn());
vi.mock("../../store/paramDialog", () => ({ askParams: ask }));

const axis = { lim: null, scale: null, step: null, fmt: null, label: "", color: null };
const over = { left: 100, right: 500, top: 0, bottom: 300 };
const root = { left: 0, right: 760, top: 0, bottom: 340 };
// Y2 at 500, Y3 at 580, Y4 at 660 (one 80 px slot each).
const rights = [500, 580, 660];

beforeEach(() => {
  ask.mockReset().mockResolvedValue(null);
  useFigureDialog.setState({ open: null });
  useApp.setState({
    datasets: [{ id: "d", name: "d", data: { time: [0, 1], values: [[1, 2, 3, 4], [2, 3, 4, 5]], labels: ["A", "B", "C", "D"], units: ["", "", "", ""], metadata: {} } }],
    activeId: "d", xKey: null, yKeys: [0, 1, 2, 3], seriesOrder: null, hiddenChannels: [],
    y2Keys: [1], yAxes: [axis, axis], yAxisOf: { 2: 3, 3: 4 },
  });
});

describe("double-click on a right-hand axis with Y3+ axes", () => {
  it("the innermost is Y2: its Axis dialog", () => {
    openAxisAt(over, root, 520, 150, true, rights);
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "y2" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("further out, that axis' own settings, without asking which", () => {
    openAxisAt(over, root, 700, 150, true, rights);
    expect(ask).toHaveBeenCalledTimes(1); // asked synchronously: no wait
    expect(ask.mock.calls[0][0]).toBe("Y4 Axis");
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("a hidden Y2 takes no slot: the innermost axis is then Y3", () => {
    useApp.setState({ hiddenChannels: [1] });
    openAxisAt(over, root, 520, 150, true, [500, 580]);
    expect(ask).toHaveBeenCalledTimes(1); // asked synchronously: no wait
    expect(ask.mock.calls[0][0]).toBe("Y3 Axis");
  });

  it("reads the drawn right-hand axes off the chart element", () => {
    const chart = document.createElement("div");
    for (const [left, width] of [[40, 60], [660, 80], [500, 80], [580, 0], [580, 80]]) {
      const el = chart.appendChild(document.createElement("div"));
      el.className = "u-axis";
      el.getBoundingClientRect = () => ({ left, width }) as DOMRect;
    }
    expect(rightAxisLefts(chart, 500)).toEqual([500, 580, 660]); // Y1 and the zero-width (hidden) axis left out
    openAxisAt(over, root, 700, 150, true, chart);
    expect(ask.mock.calls[0][0]).toBe("Y4 Axis");
  });
});
