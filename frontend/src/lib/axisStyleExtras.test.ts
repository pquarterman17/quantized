// Gap-audit-2 #5: the Axis dialog's axis-look fields on the canvas
// (lib/axisStyleExtras.ts through lib/axisExtras.ts), their sanitizer, and
// the dialog model that writes them. The export half: tests/test_axis_style.py.

import type uPlot from "uplot";
import { beforeAll, describe, expect, it } from "vitest";

import { axisDraft, axisDraftErrors, axisPatch, type AxisView } from "./axisDialogModel";
import { loadAxisExtras } from "./axisExtrasHook";
import { inheritedAxisFormat, sanitizeAxisExtras, type AxisFormat } from "./axisFormat";
import { topTicks } from "./axisTop";
import { buildOpts } from "./uplotOpts";

const payload = (y2 = false) => ({
  data: [[100, 200, 300], [0, 1, 2], ...(y2 ? [[5, 6, 7]] : [])],
  series: [{ label: "y", unit: "", axis: 0 }, ...(y2 ? [{ label: "z", unit: "", axis: 1 }] : [])],
  xLabel: "T",
  xUnit: "K",
});
const args = { width: 400, height: 300, xScale: "linear" as const, yScale: "linear" as const, tool: "zoom" as const, onReadout: () => {} };
const fmt = (extra: Partial<AxisFormat>): AxisFormat => ({ mode: "auto", digits: 2, ...extra });
const build = (extra: Record<string, unknown>, y2 = false) => buildOpts(payload(y2) as never, { ...args, ...extra } as never);

beforeAll(async () => {
  await loadAxisExtras();
});

describe("axis look on the canvas", () => {
  it("reverse turns the Y scale high-to-low; a Y2 inheriting Y's format is not reversed", () => {
    const opts = build({ yFmt: fmt({ reverse: true }) }, true);
    expect(opts.scales?.y?.dir).toBe(-1);
    expect(opts.scales?.y2?.dir ?? 1).toBe(1);
    const own = build({ yFmt: fmt({}), y2Fmt: fmt({ reverse: true }) }, true);
    expect(own.scales?.y2?.dir).toBe(-1);
    expect(own.scales?.y?.dir ?? 1).toBe(1);
  });

  it("an axis grid sets colour and dash, and can hide that axis' grid", () => {
    const opts = build({ xFmt: fmt({ grid: { major: true, minor: true, color: "#ff0000", dash: "dash" } }), yFmt: fmt({ grid: { major: false, minor: false } }) });
    const [x, y] = opts.axes as uPlot.Axis[];
    expect(x.grid).toMatchObject({ show: true, stroke: "#ff0000" });
    expect(x.grid?.dash?.length).toBe(2);
    expect(y.grid?.show).toBe(false);
    // The minor grid draws under the series (drawAxes), from the extras plugin.
    expect(opts.plugins?.some((p) => typeof p.hooks?.drawAxes === "function")).toBe(true);
  });

  it("rotation rotates the X labels and grows the axis to fit", () => {
    const x = (build({ xFmt: fmt({ rotate: 45 }) }).axes as uPlot.Axis[])[0];
    expect(x.rotate).toBe(45);
    expect(typeof x.size).toBe("function");
  });

  it("offset hides uPlot's frame-hugging ticks and pushes the labels out", () => {
    const plain = (build({}).axes as uPlot.Axis[])[1];
    const moved = (build({ yFmt: fmt({ offset: 9 }) }).axes as uPlot.Axis[])[1];
    expect(moved.ticks?.show).toBe(false);
    expect((moved.gap ?? 0) - (plain.gap ?? 5)).toBe(10 + 12); // the hidden 10 px ticks + 9 pt
  });

  it("a top axis is added after x/y/y2 and labels the transform's ticks", () => {
    const top = { kind: "reciprocal" as const, factor: 1000, title: "1000/T" };
    const axes = build({ xFmt: fmt({ top }) }).axes as uPlot.Axis[];
    expect(axes).toHaveLength(3);
    const t = axes[2];
    expect(t).toMatchObject({ side: 0, scale: "x", label: "1000/T" });
    const splits = (t.splits as (u: uPlot, i: number, min: number, max: number) => number[])({} as uPlot, 2, 100, 300);
    expect(splits).toEqual(topTicks(top, 100, 300).map((k) => k.pos));
    expect((t.values as () => string[])()).toEqual(["10", "9", "8", "7", "6", "5", "4"]);
  });
});

describe("axis look fields: sanitizer and Y2 inheritance", () => {
  it("keeps valid fields and drops junk from a file or template", () => {
    const raw = { mode: "auto", digits: 2, reverse: true, rotate: 200, offset: -1, grid: { major: true, minor: 1, color: "red", dash: "wavy" }, top: { kind: "dspacing", wavelength: 1.54, factor: "x", title: "d" } } as never;
    expect(sanitizeAxisExtras(raw)).toEqual({ mode: "auto", digits: 2, reverse: true, grid: { major: true, minor: false }, top: { kind: "dspacing", wavelength: 1.54, title: "d" } });
    expect(sanitizeAxisExtras({ mode: "auto", digits: 2, top: { kind: "log" } } as never)).toEqual({ mode: "auto", digits: 2 });
  });

  it("a Y2 axis inherits Y's number format but not Y's reverse, offset or grid", () => {
    const y = fmt({ mode: "fixed", digits: 3, reverse: true, offset: 5, grid: { major: true, minor: false }, rotate: 10 });
    expect(inheritedAxisFormat(y)).toEqual({ mode: "fixed", digits: 3, rotate: 10 });
  });
});

describe("Axis dialog model: the new fields round-trip", () => {
  const view: AxisView = {
    xScale: "linear", yScale: "linear", y2Scale: null, xLim: null, yLim: null, y2Lim: null, xStep: null, yStep: null, y2Step: null,
    xFmt: fmt({}), yFmt: fmt({}), y2Fmt: null, axisLabelStyles: {}, xReversed: false,
  };

  it("X: reverse is the view's xReversed; rotation, grid, offset and the top axis ride xFmt", () => {
    const d = { ...axisDraft(view, "x"), reverse: true, rotate: "30", offset: "4", gridLines: "both" as const, gridColor: "#00AA00", gridDash: "dot" as const, topKind: "dspacing" as const, topWavelength: "1.5406", topTitle: "d (Å)" };
    expect(axisDraftErrors(d, "x")).toEqual([]);
    const patch = axisPatch(view, "x", d);
    expect(patch.xReversed).toBe(true);
    expect(patch.xFmt).toMatchObject({ rotate: 30, offset: 4, grid: { major: true, minor: true, color: "#00aa00", dash: "dot" }, top: { kind: "dspacing", wavelength: 1.5406, title: "d (Å)" } });
    expect(axisDraft({ ...view, ...patch } as AxisView, "x")).toEqual({ ...d, gridColor: "#00aa00" });
  });

  it("Y: reverse rides yFmt; rotation and the top axis are X-only", () => {
    const d = { ...axisDraft(view, "y"), reverse: true, rotate: "30", topKind: "reciprocal" as const };
    const patch = axisPatch(view, "y", d);
    expect(patch.yFmt).toMatchObject({ reverse: true });
    expect(patch.yFmt?.rotate).toBeUndefined();
    expect(patch.yFmt?.top).toBeUndefined();
  });

  it("refuses a d-spacing axis with no wavelength, a bad colour and an out-of-range rotation", () => {
    const d = { ...axisDraft(view, "x"), topKind: "dspacing" as const, topWavelength: "", gridColor: "green", rotate: "120" };
    expect(axisDraftErrors(d, "x").join(" ")).toMatch(/wavelength.*|colour|Rotation/);
    expect(axisDraftErrors(d, "x")).toHaveLength(3);
  });
});
