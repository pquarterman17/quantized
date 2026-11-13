// Y-axis breaks on the interactive canvas (lib/axisBreakExtras.ts through
// lib/axisExtras.ts and uplotOpts.buildOpts), the Axis dialog model that
// authors them, and the export wire that carries them.

import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { activeBreaks, seriesExtent, type AxisExtrasContext } from "./axisBreakExtras";
import { breakAutoRange, breakTicks } from "./axisBreaks";
import { axisDraft, axisDraftErrors, axisPatch } from "./axisDialogModel";
import { applyAxisExtras } from "./axisExtras";
import { loadAxisExtras } from "./axisExtrasHook";
import { axisFmtParam, hasAxisExtras, inheritedAxisFormat, sanitizeAxisExtras } from "./axisFormat";
import { resolveSecondaryAxis } from "./axisspec";
import { defaultPlotView } from "./plotview";
import type { AxisFormat } from "./types";
import { buildOpts } from "./uplotOpts";

const BREAKS: [number, number][] = [[12, 990]];
const broken: AxisFormat = { mode: "auto", digits: 2, breaks: BREAKS };

const PAYLOAD = {
  data: [
    [0, 1, 2],
    [2, 6, 12],
    [1000, 1004, 1010],
    [5000, 5001, 5002],
  ],
  series: [{ label: "low", unit: "", axis: 0 }, { label: "high", unit: "", axis: 0 }, { label: "right", unit: "", axis: 1 }],
  xLabel: "x",
  xUnit: "",
};

function context(over: Partial<AxisExtrasContext> = {}): AxisExtrasContext {
  return {
    scales: { x: {}, y: { distr: 1 }, y2: { distr: 1 } },
    payload: PAYLOAD,
    typed: [false, false, false],
    steps: [null, null, null],
    scan: false,
    y2Own: false,
    ...over,
  };
}

type Splits = (u: uPlot, axisIdx: number, min: number, max: number, incr: number, space: number) => number[];
type Range = (u: uPlot, min: number | null, max: number | null, key: string) => [number | null, number | null];

describe("axis breaks on the canvas", () => {
  it("turns a linear Y scale into the broken one: transform, ticks and auto range", () => {
    const ctx = context();
    const axes: uPlot.Axis[] = [{}, { scale: "y" }];
    const plugin = applyAxisExtras(axes, [{ mode: "auto", digits: 2 }, broken], ["linear", "linear"], "#000", ctx);
    expect(plugin).not.toBeNull();
    const y = ctx.scales.y;
    expect(y.distr).toBe(100);
    // 978 units are elided: 990 sits one gap above 12, not 978 above it.
    const gapPx = y.fwd!(990) - y.fwd!(12);
    expect(gapPx).toBeGreaterThan(0);
    expect(gapPx).toBeLessThan(2);
    expect(y.bwd!(y.fwd!(1004))).toBeCloseTo(1004, 9);
    expect((axes[1].splits as Splits)({} as uPlot, 1, 0, 1012, 200, 40)).toEqual(breakTicks(0, 1012, BREAKS));
    expect((y.range as Range)({} as uPlot, 2, 1010, "y")).toEqual(breakAutoRange(2, 1010, BREAKS));
    expect((y.range as Range)({} as uPlot, null, null, "y")).toEqual([null, null]);
    expect(ctx.scales.x).toEqual({}); // x is never broken this way
  });

  it("labels every tick: uPlot's distr >= 3 default filter is the log one (live check)", () => {
    const axes: uPlot.Axis[] = [{}, { scale: "y" }];
    applyAxisExtras(axes, [{ mode: "auto", digits: 2 }, broken], ["linear", "linear"], "#000", context());
    const splits = breakTicks(0, 1012, BREAKS);
    expect(typeof axes[1].filter).toBe("function");
    expect((axes[1].filter as (u: uPlot, s: number[], i: number, sp: number, inc: number) => (number | null)[])({} as uPlot, splits, 1, 40, 5)).toEqual(splits);
  });

  it("a typed limit keeps its range; a typed increment sets the ticks", () => {
    const typed = [1, 990] as [number, number];
    const ctx = context({ scales: { x: {}, y: { distr: 1, range: typed } }, typed: [false, true, false], steps: [null, 4, null] });
    const axes: uPlot.Axis[] = [{}, { scale: "y" }];
    applyAxisExtras(axes, [null, broken], ["linear", "linear"], "#000", ctx);
    expect(ctx.scales.y.range).toBe(typed);
    expect((axes[1].splits as Splits)({} as uPlot, 1, 0, 1012, 200, 40)).toEqual(breakTicks(0, 1012, BREAKS, 4));
  });

  it("hands the tick formatter the increment of the ticks actually drawn", () => {
    const seen: number[] = [];
    const axes: uPlot.Axis[] = [{}, { scale: "y", values: (_u, splits, _i, _s, incr) => { seen.push(incr); return splits.map(String); } }];
    applyAxisExtras(axes, [null, { mode: "auto", digits: 2, breaks: [[0.2, 5]] }], ["linear", "linear"], "#000", context());
    const values = axes[1].values as (u: uPlot, splits: number[], i: number, space: number, incr: number) => unknown;
    values({} as uPlot, [0, 0.1, 0.2, 5, 5.1], 1, 40, 1);
    expect(seen[0]).toBeCloseTo(0.1, 9); // not uPlot's 1, which would print "0", "0", "0"
  });

  it("is refused where it means nothing: X, a log axis, an inherited Y2, no context", () => {
    const ctx = context();
    expect(activeBreaks(0, BREAKS, "linear", ctx)).toBeNull();
    expect(activeBreaks(1, BREAKS, "log", ctx)).toBeNull();
    expect(activeBreaks(1, BREAKS, "reciprocal", ctx)).toBeNull();
    expect(activeBreaks(2, BREAKS, "linear", ctx)).toBeNull(); // inherited from Y
    expect(activeBreaks(2, BREAKS, "linear", context({ y2Own: true }))).toEqual(BREAKS);
    expect(activeBreaks(1, BREAKS, "linear", undefined)).toBeNull();
    expect(activeBreaks(1, [], "linear", ctx)).toBeNull();
    const axes: uPlot.Axis[] = [{ scale: "x" }, { scale: "y" }];
    applyAxisExtras(axes, [broken, { ...broken }], ["linear", "log"], "#000", ctx);
    expect(ctx.scales.y.distr).toBe(1);
    expect(axes[1].splits).toBeUndefined();
  });

  it("measures each axis' own visible series for the gap", () => {
    expect(seriesExtent(PAYLOAD, 0)).toEqual([2, 1010]);
    expect(seriesExtent(PAYLOAD, 1)).toEqual([5000, 5002]);
    expect(seriesExtent(PAYLOAD, 0, [false, true, false])).toEqual([2, 12]); // hidden "high"
    expect(seriesExtent({ data: [[0]], series: [] }, 0)).toBeNull();
  });

  it("a non-ascending x (hysteresis loop) ranges the broken axis by its full scan", () => {
    const ctx = context({ scan: true });
    applyAxisExtras([{}, { scale: "y" }], [null, broken], ["linear", "linear"], "#000", ctx);
    // uPlot's windowed min/max is not trusted for a loop: the full extent rules.
    expect((ctx.scales.y.range as Range)({} as uPlot, 500, 600, "y")).toEqual(breakAutoRange(2, 1010, BREAKS));
  });

  it("buildOpts breaks the Y scale once the on-demand module has loaded", async () => {
    await loadAxisExtras();
    const args = { width: 400, height: 300, xScale: "linear" as const, yScale: "linear" as const, tool: "zoom" as const, onReadout: () => {} };
    const plain = buildOpts(PAYLOAD as never, args as never);
    const withBreak = buildOpts(PAYLOAD as never, { ...args, yFmt: broken } as never);
    expect(plain.scales?.y?.distr).toBe(1);
    expect(withBreak.scales?.y?.distr).toBe(100);
    expect((withBreak.plugins?.length ?? 0) - (plain.plugins?.length ?? 0)).toBe(1);
    // A log Y keeps its own scale.
    expect(buildOpts(PAYLOAD as never, { ...args, yScale: "log", yFmt: broken } as never).scales?.y?.distr).toBe(3);
  });
});

describe("axis breaks — stored, inherited and sent", () => {
  it("counts as an extra, survives sanitizing, and reaches the export on an auto format", () => {
    expect(hasAxisExtras(broken)).toBe(true);
    expect(axisFmtParam(broken)).toEqual(broken);
    expect(sanitizeAxisExtras({ mode: "auto", digits: 2, breaks: [[5, 1], [3, 4]] })).toEqual({ mode: "auto", digits: 2, breaks: [[3, 4]] });
    expect(sanitizeAxisExtras({ mode: "auto", digits: 2, breaks: "x" as never })).toEqual({ mode: "auto", digits: 2 });
  });

  it("a Y2 axis with no format of its own inherits everything but the breaks", () => {
    expect(inheritedAxisFormat({ ...broken, minor: 2 })).toEqual({ mode: "auto", digits: 2, minor: 2 });
    const plain: AxisFormat = { mode: "fixed", digits: 1 };
    expect(inheritedAxisFormat(plain)).toBe(plain);
    const spec = { keys: [1], lim: null, scale: null, fmt: null, step: null, label: "" };
    expect(resolveSecondaryAxis([0, 1], spec, { scale: "linear", fmt: broken })?.fmt).toEqual({ mode: "auto", digits: 2 });
    expect(resolveSecondaryAxis([0, 1], { ...spec, fmt: broken }, { scale: "linear", fmt: plain })?.fmt).toEqual(broken);
  });
});

describe("Axis dialog model — the Break rows", () => {
  const view = defaultPlotView();

  it("round-trips a Y break and clears it when both rows are blanked", () => {
    const set = axisPatch(view, "y", { ...axisDraft(view, "y"), breakFrom: "12", breakTo: "990" });
    expect(set.yFmt?.breaks).toEqual([[12, 990]]);
    const after = { ...view, ...set };
    const draft = axisDraft(after, "y");
    expect([draft.breakFrom, draft.breakTo]).toEqual(["12", "990"]);
    expect(axisPatch(after, "y", { ...draft, breakFrom: "", breakTo: "" }).yFmt?.breaks).toBeUndefined();
  });

  it("keeps further breaks a file carried, and never offers Y's break to Y2 or X", () => {
    const two = { ...view, yFmt: { mode: "auto" as const, digits: 2, breaks: [[1, 2], [100, 200]] as [number, number][] } };
    const d = axisDraft(two, "y");
    expect(axisPatch(two, "y", { ...d, breakFrom: "3", breakTo: "4" }).yFmt?.breaks).toEqual([[3, 4], [100, 200]]);
    expect(axisDraft(two, "y2").breakFrom).toBe(""); // inherited format: no break
    expect(axisDraft({ ...view, xFmt: { mode: "auto", digits: 2, breaks: [[1, 2]] } }, "x").breakFrom).toBe("");
    const y2 = axisPatch(view, "y2", { ...axisDraft(view, "y2"), breakFrom: "5", breakTo: "9" });
    expect(y2.y2Fmt?.breaks).toEqual([[5, 9]]);
  });

  it("validates the break before Apply", () => {
    const d = axisDraft(view, "y");
    expect(axisDraftErrors({ ...d, breakFrom: "5" }, "y").join(" ")).toMatch(/both Break from and Break to/);
    expect(axisDraftErrors({ ...d, breakFrom: "9", breakTo: "5" }, "y").join(" ")).toMatch(/must be below/);
    expect(axisDraftErrors({ ...d, breakFrom: "x", breakTo: "5" }, "y").join(" ")).toMatch(/Break from must be a number/);
    expect(axisDraftErrors({ ...d, scale: "log", breakFrom: "5", breakTo: "9" }, "y").join(" ")).toMatch(/needs a linear scale/);
    expect(axisDraftErrors({ ...d, breakFrom: "5", breakTo: "9" }, "y")).toEqual([]);
  });
});
