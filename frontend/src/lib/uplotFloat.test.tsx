// Floating column (SeriesStyle.float) and the stacked-series cursor readout.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SeriesBarsControl from "../components/Inspector/SeriesBarsControl";
import PlotReadouts from "../components/Stage/PlotReadouts";
import { buildExportStyles } from "./exportStyles";
import { plotTypePatch, plotTypeUnavailable } from "./plotTypes";
import { barPaths, FLOAT_LOW_PATHS } from "./uplotBars";
import { readoutPlugin } from "./uplotPointerTools";
import { floatIsLow, floatLowColumn } from "./uplotStack";
import { readoutStacks, type Readout } from "./uplotTools";

class FakePath {
  rects: number[][] = [];
  rect(...r: number[]) { this.rects.push(r); }
}
const withPath = <T,>(fn: () => T): T => {
  const g = globalThis as unknown as { Path2D: unknown };
  const saved = g.Path2D;
  g.Path2D = FakePath;
  try { return fn(); } finally { g.Path2D = saved; }
};
type Paths = (...a: unknown[]) => { stroke: FakePath };

describe("floating column", () => {
  const styles = [{ bars: true as const, float: "low" as const }, { bars: true as const, float: "high" as const }];

  it("pairs a high with the low directly before it on the same axis", () => {
    expect(floatLowColumn(styles, [0, 0], 1)).toBe(1);
    expect(floatIsLow(styles, [0, 0], 0)).toBe(true);
    expect(floatLowColumn(styles, [0, 1], 1)).toBeNull(); // another Y axis
    expect(floatLowColumn([styles[0], { float: "high" }], [0, 0], 1)).toBeNull(); // the high is not bars
    expect(floatIsLow([styles[0], { bars: true }], [0, 0], 0)).toBe(false); // a lone low still draws
    expect(floatLowColumn(styles, [0, 0], 0)).toBeNull();
  });

  it("each bar runs from the low value to the high value; a missing end draws no bar", () => {
    const u = {
      data: [[10, 20, 30], [1, 2, null], [4, 3, 5]],
      series: [{}, { scale: "y" }, { scale: "y" }],
      valToPos: (v: number, scale: string) => (scale === "x" ? v : 100 - v),
    };
    const rects = withPath(() => (barPaths([], 1) as unknown as Paths)(u, 2, 0, 2).stroke.rects);
    // gap 10 -> width 6; row 0: 1..4 -> pixels 99..96; row 1: 2..3; row 2: low missing
    expect(rects).toEqual([[7, 96, 6, 3], [17, 97, 6, 1]]);
    expect(withPath(() => (FLOAT_LOW_PATHS as unknown as Paths)().stroke.rects)).toEqual([]);
  });

  it("the gallery tile pairs the plotted columns; an odd last column stays an ordinary bar", () => {
    const view = { seriesStyles: {}, statPicks: {} };
    const s = plotTypePatch("floatColumn", view, [0, 1, 2]).seriesStyles!;
    expect(s[0]).toMatchObject({ bars: true, float: "low" });
    expect(s[1]).toMatchObject({ bars: true, float: "high" });
    expect(s[2]).toMatchObject({ bars: true });
    expect(s[2].float).toBeUndefined();
    const back = plotTypePatch("line", { seriesStyles: s, statPicks: {} }, [0, 1, 2]).seriesStyles!;
    expect(back[1].float).toBeUndefined();
    expect(back[1].bars).toBeUndefined();
  });

  it("needs two Y columns", () => {
    const ds = (labels: string[]) => ({ id: "d", name: "d", data: { time: [0], values: [labels.map(() => 0)], labels, units: labels.map(() => ""), metadata: {} } });
    expect(plotTypeUnavailable("floatColumn", ds(["A"]) as never)).toMatch(/two Y/);
    expect(plotTypeUnavailable("floatColumn", ds(["A", "B"]) as never)).toBeNull();
  });

  it("travels to the export", () => {
    const out = buildExportStyles([0, 1], { 0: styles[0], 1: styles[1] });
    expect(out[0]).toMatchObject({ bars: true, float: "low" });
    expect(out[1]).toMatchObject({ float: "high" });
  });

  it("the Series card pairs this series with the one above, and clears both", () => {
    const set = vi.fn();
    const { rerender } = render(<SeriesBarsControl channel={2} above={1} style={{ bars: true }} setSeriesStyle={set} />);
    fireEvent.click(screen.getByLabelText(/Floats from the series above/));
    expect(set).toHaveBeenCalledWith(1, { float: "low", bars: true, marker: false, fill: undefined });
    expect(set).toHaveBeenCalledWith(2, { float: "high", stack: undefined });
    set.mockClear();
    rerender(<SeriesBarsControl channel={2} above={1} style={{ bars: true, float: "high" }} setSeriesStyle={set} />);
    fireEvent.click(screen.getByLabelText(/Floats from the series above/));
    expect(set).toHaveBeenCalledWith(1, { float: undefined });
    expect(set).toHaveBeenCalledWith(2, { float: undefined });
    // no bars, nothing above, or this series is a low end: not offered
    const off = [{ style: {}, above: 1 }, { style: { bars: true }, above: undefined }, { style: { bars: true, float: "low" as const }, above: 1 }];
    for (const props of off) {
      rerender(<SeriesBarsControl channel={2} setSeriesStyle={set} {...props} />);
      expect((screen.getByLabelText(/Floats from the series above/) as HTMLInputElement).disabled).toBe(true);
    }
  });
});

describe("stacked-series cursor readout", () => {
  const data = [[10, 20], [1, 2], [4, 5], [7, 8]];
  const series = [{}, { label: "A" }, { label: "B" }, { label: "C" }];
  const read = (stacks?: number[][]): Readout | null => {
    let got: Readout | null = null;
    const p = readoutPlugin((r) => (got = r), undefined, undefined, undefined, stacks);
    // @ts-expect-error minimal stub for a uPlot instance
    p.hooks.setCursor?.({ cursor: { idx: 1 }, data, series });
    return got;
  };

  it("derives each column's stack from the series styles", () => {
    expect(readoutStacks([{}, {}, {}], [{ stack: true }, { stack: true }, undefined])).toEqual([[], [], [1], []]);
  });

  it("adds the running total beside the own value of a stacked series only", () => {
    const r = read([[], [], [1], []]);
    expect(r?.rows).toEqual([{ label: "A", y: 2 }, { label: "B", y: 5, total: 7 }, { label: "C", y: 8 }]);
  });

  it("without stacks the rows are unchanged", () => {
    expect(read()?.rows.every((row) => row.total === undefined)).toBe(true);
  });

  it("the chip shows both numbers", () => {
    render(<PlotReadouts tool="cursor" readout={{ x: 1, rows: [{ label: "B", y: 5, total: 7 }] }} measurement={null} stats={null} />);
    expect(screen.getByText(/5\.0000 \(total 7\.0000\)/)).toBeTruthy();
  });
});
