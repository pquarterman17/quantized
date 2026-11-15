// The canvas half of Origin-style multiple Y axes (gap audit 4 G11): one
// uPlot scale + right axis per extra axis, the slot geometry, its own colour
// and line, error bars counted on its own range, and the lane-H axis extras
// (log2 / probability / custom ticks) reaching it at the right index.

import type uPlot from "uplot";
import { beforeAll, describe, expect, it } from "vitest";

import { loadAxisExtras } from "./axisExtrasHook";
import { MULTI_Y_SLOT_PT, resolveExtraYAxes, withExtraYAxes, type ExtraYAxis } from "./multiY";
import type { PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";

const SLOT_PX = (MULTI_Y_SLOT_PT * 96) / 72;

function payload(axes: number[]): PlotPayload {
  return {
    data: [[1, 2, 3], ...axes.map((_, i) => [10 * (i + 1), 20 * (i + 1), 30 * (i + 1)])],
    series: axes.map((axis, i) => ({ label: `S${i}`, unit: "", axis })),
    xLabel: "x",
    xUnit: "",
  } as unknown as PlotPayload;
}

function opts(y2: boolean, extra: ExtraYAxis[], of: Record<number, number>, errorSpans?: Map<number, { axis: "y"; plus: number[]; minus: number[] }[]>) {
  const plotted = [0, 1, 2, 3].slice(0, 2 + extra.length);
  const base = payload(plotted.map((ch) => (y2 && ch === 1 ? 1 : 0)));
  const { axes } = resolveExtraYAxes(plotted, { yAxes: extra, yAxisOf: of }, { scale: "linear", fmt: { mode: "auto", digits: 2 } });
  return buildOpts(withExtraYAxes(base, plotted, axes), {
    width: 800, height: 500, tool: "cursor", onReadout: () => {}, yScale: "linear", xScale: "linear", yAxes: axes, plotted, errorSpans,
  });
}

const axis = (over: Partial<ExtraYAxis> = {}): ExtraYAxis => ({ lim: null, scale: null, step: null, fmt: null, label: "", color: null, ...over });

beforeAll(() => loadAxisExtras());

describe("uplotMultiY", () => {
  it("adds a scale and a right axis per extra axis, binding its series", () => {
    const o = opts(true, [axis({ color: "#ff0000", label: "M" })], { 2: 3 });
    const right = o.axes!.filter((a) => Number(a.side) === 1);
    expect(right.map((a) => a.scale)).toEqual(["y2", "y3"]);
    expect(o.series!.slice(1).map((s) => s.scale)).toEqual(["y", "y2", "y3"]);
    expect(o.scales!.y3).toBeDefined();
    const y3 = right[1];
    expect(y3).toMatchObject({ stroke: "#ff0000", label: "M", border: { show: true, stroke: "#ff0000" } });
    expect((y3.ticks as uPlot.Axis.Ticks).stroke).toBe("#ff0000");
    // Every right axis but the outermost takes exactly one slot.
    expect((right[0].size as number) + (right[0].label != null ? right[0].labelSize! : 0)).toBe(SLOT_PX);
    expect(typeof y3.size).toBe("function");
  });

  it("a fixed range wins; otherwise it autoscales over its own series and error bars", () => {
    expect(opts(false, [axis({ lim: [0, 99] })], { 2: 3 }).scales!.y3.range).toEqual([0, 99]);
    const spans = new Map([[3, [{ axis: "y" as const, plus: [500, 500, 500], minus: [0, 0, 0] }]]]);
    const range = opts(false, [axis()], { 2: 3 }, spans).scales!.y3.range as uPlot.Range.Function;
    const u = { data: [[1, 2, 3]], series: [{}, {}, {}, { show: true }], scales: { y3: { distr: 1 } } } as unknown as uPlot;
    expect((range(u, 30, 90, "y3") as number[])[1]).toBeGreaterThanOrEqual(590);
  });

  it("takes the axis-dialog extras at its own index, with or without a Y2", () => {
    const custom = { mode: "auto" as const, digits: 2, custom: { at: [35, 75], labels: ["lo", "hi"] } };
    for (const y2 of [false, true]) {
      const o = opts(y2, [axis({ fmt: custom, lim: [0, 100] })], { 2: 3 });
      const y3 = o.axes!.find((a) => a.scale === "y3")!;
      const at = (y3.splits as (...a: unknown[]) => number[])({}, 0, 0, 100, 0, 0);
      expect(at).toEqual([35, 75]);
    }
    const prob = opts(false, [axis({ fmt: { mode: "auto", digits: 2, prob: "percent" } })], { 2: 3 });
    expect(prob.scales!.y3.distr).toBe(100);
  });

  it("without extra axes the options are what they always were", () => {
    const o = opts(true, [], {});
    expect(o.axes!.filter((a) => Number(a.side) === 1).map((a) => a.scale)).toEqual(["y2"]);
    expect(Object.keys(o.scales!).sort()).toEqual(["x", "y", "y2"]);
  });
});
