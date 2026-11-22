import { describe, expect, it } from "vitest";

import { applyPlotType } from "./figureDialogActions";
import { defaultPlotView } from "./plotview";
import { plotTypePatch } from "./plotTypes";
import { barPaths } from "./uplotBars";
import { errorReach } from "./uplotErrorRange";
import { stackBase, stackedAreaPaths, stackedBelow } from "./uplotStack";
import { useApp } from "../store/useApp";
import type { PlotPayload } from "./plotdata";

class FakePath {
  rects: number[][] = [];
  ops: (string | number)[][] = [];
  rect(...r: number[]) { this.rects.push(r); }
  moveTo(x: number, y: number) { this.ops.push(["M", x, y]); }
  lineTo(x: number, y: number) { this.ops.push(["L", x, y]); }
  closePath() { this.ops.push(["Z"]); }
}
const withPath = <T,>(fn: () => T): T => {
  const g = globalThis as unknown as { Path2D: unknown };
  const saved = g.Path2D;
  g.Path2D = FakePath;
  try { return fn(); } finally { g.Path2D = saved; }
};
// x maps 1:1, y grows downward: value v sits at pixel 100 - v
const u = (data: (number | null)[][]) => ({
  data,
  series: [{}, { scale: "y" }, { scale: "y" }],
  valToPos: (v: number, scale: string) => (scale === "x" ? v : 100 - v),
});

describe("stacking", () => {
  it("stackedBelow lists earlier stacked series on the same axis only", () => {
    const styles = [{ stack: true }, { stack: true }, undefined, { stack: true }, { stack: true }];
    expect(stackedBelow(styles, [0, 0, 0, 1, 0], 4)).toEqual([1, 2]);
    expect(stackedBelow(styles, [0, 0, 0, 1, 0], 0)).toEqual([]);
    expect(stackedBelow(styles, [0, 0, 0, 1, 0], 2)).toEqual([]); // not stacked itself
  });

  it("stackBase ignores missing values", () => {
    expect(stackBase([[], [1, null], [2, 5]], [1, 2], 1)).toBe(5);
  });

  it("a stacked bar runs from the total below to the new total", () => {
    const rects = withPath(() => {
      const out = (barPaths([1]) as unknown as (...a: unknown[]) => { stroke: FakePath })(u([[10, 20], [5, 4], [3, 2]]), 2, 0, 1);
      return out.stroke.rects;
    });
    // gap 10 -> width 6; row 0: base 5, top 8 -> pixels 95..92; row 1: base 4, top 6
    expect(rects).toEqual([[7, 92, 6, 3], [17, 94, 6, 2]]);
  });

  it("a stacked area strokes the new total and fills down to the total below", () => {
    const out = withPath(() =>
      (stackedAreaPaths([1]) as unknown as (...a: unknown[]) => { stroke: FakePath; fill: FakePath })(u([[0, 10], [5, 4], [3, 2]]), 2, 0, 1),
    );
    expect(out.stroke.ops).toEqual([["M", 0, 92], ["L", 10, 94]]);
    expect(out.fill.ops).toEqual([["M", 0, 92], ["L", 10, 94], ["L", 10, 96], ["L", 0, 95], ["Z"]]);
  });

  it("the autoscale reach covers the stacked totals", () => {
    const payload = {
      data: [[1, 2], [5, 4], [3, 2]],
      series: [{ axis: 0 }, { axis: 0 }],
    } as unknown as PlotPayload;
    const reach = errorReach(payload, undefined, undefined, [{ stack: true }, { stack: true }]);
    expect(reach).toEqual([
      { series: 0, on: 0, rows: [[5, 0], [4, 0]] },
      { series: 1, on: 0, rows: [[8, 5], [6, 4]] },
    ]);
    expect(errorReach(payload, undefined, undefined, [{}, {}])).toBeNull();
  });
});

describe("stacked gallery tiles", () => {
  const view = { seriesStyles: {}, statPicks: {} };
  it("set stack with bars or an under-fill, and leaving them clears it", () => {
    const col = plotTypePatch("stackedColumnX", view, [0, 1]).seriesStyles!;
    expect(col[1]).toMatchObject({ bars: true, stack: true });
    const bar = plotTypePatch("stackedBarH", view, [0, 1]).seriesStyles!;
    expect(bar[0]).toMatchObject({ bars: "horizontal", stack: true });
    const area = plotTypePatch("stackedArea", view, [0, 1]).seriesStyles!;
    expect(area[1]).toMatchObject({ fill: "under", stack: true });
    expect(area[1].bars).toBeUndefined();
    const back = plotTypePatch("area", { seriesStyles: area, statPicks: {} }, [0, 1]).seriesStyles!;
    expect(back[1].stack).toBeUndefined();
  });

  it("apply through the gallery action", () => {
    useApp.setState({
      ...defaultPlotView(),
      datasets: [{ id: "d", name: "d.csv", data: { time: [0, 1], values: [[1, 2], [2, 3]], labels: ["A", "B"], units: ["", ""], metadata: {} } }],
      activeId: "d", history: [], future: [], status: "",
    });
    applyPlotType("stackedArea");
    expect(useApp.getState().seriesStyles[1]).toMatchObject({ fill: "under", stack: true });
  });
});
