// Figures-audit #6: the Axis dialog's extras on the interactive canvas
// (lib/axisExtras.ts) -- and the export wire that carries them.

import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { applyAxisExtras, divideLabel, lnSplits } from "./axisExtras";
import { loadAxisExtras } from "./axisExtrasHook";
import { axisFmtParam, sanitizeAxisExtras, type AxisFormat } from "./types";
import { buildOpts } from "./uplotOpts";

type Values = (u: uPlot, splits: number[], axisIdx: number, space: number, incr: number) => (string | number | null)[];

describe("axis extras", () => {
  it("divide-by scales the tick labels and labels the factor like the export", () => {
    const axes: uPlot.Axis[] = [{ values: (_u, splits) => splits.map((v) => String(v)) }];
    const plugin = applyAxisExtras(axes, [{ mode: "auto", digits: 2, divide: 0.001 }], ["linear"], "#000");
    expect(plugin).not.toBeNull();
    expect((axes[0].values as Values)({} as uPlot, [0.001, 0.002], 0, 0, 0.001)).toEqual(["1", "2"]);
    expect(divideLabel(0.001)).toBe("×10⁻³");
    expect(divideLabel(2.5)).toBe("×2.5");
  });

  it("Ln puts majors at powers of e on a log axis, labelled e^n", () => {
    const axes: uPlot.Axis[] = [{ filter: () => [] }];
    applyAxisExtras(axes, [{ mode: "auto", digits: 2, base: "e" }], ["log"], "#000");
    expect(axes[0].filter).toBeUndefined();
    expect(lnSplits(1, 60).map((v) => Math.round(Math.log(v)))).toEqual([0, 1, 2, 3, 4]);
    expect((axes[0].values as Values)({} as uPlot, [Math.E ** 2], 0, 0, 1)).toEqual(["e²"]);
  });

  it("inward ticks hide uPlot's own and font size converts pt to px", () => {
    const axes: uPlot.Axis[] = [{ font: "10px Inter" }];
    applyAxisExtras(axes, [{ mode: "auto", digits: 2, ticks: "in", size: 9 }], ["linear"], "#000");
    expect(axes[0].ticks?.show).toBe(false);
    expect(axes[0].font).toBe("12px Inter"); // 9 pt = 12 px, as the export's labelsize
  });

  it("no extras = no plugin and an untouched axis (a plain plot is unchanged)", () => {
    const axis: uPlot.Axis = { font: "11px Inter" };
    expect(applyAxisExtras([axis], [{ mode: "fixed", digits: 3 }], ["linear"], "#000")).toBeNull();
    expect(axis).toEqual({ font: "11px Inter" });
  });

  it("buildOpts wires the extras in once the on-demand module has loaded", async () => {
    await loadAxisExtras();
    const payload = { data: [[0, 1], [0, 1]], series: [{ label: "y", unit: "", axis: 0 }], xLabel: "x", xUnit: "" };
    const args = { width: 400, height: 300, xScale: "linear" as const, yScale: "linear" as const, tool: "zoom" as const, onReadout: () => {} };
    const plain = buildOpts(payload as never, args as never);
    const extra = buildOpts(payload as never, { ...args, yFmt: { mode: "auto", digits: 2, minor: 4 } } as never);
    expect((extra.plugins?.length ?? 0) - (plain.plugins?.length ?? 0)).toBe(1);
  });

  it("an auto format with extras still reaches the export; junk extras are dropped", () => {
    const fmt: AxisFormat = { mode: "auto", digits: 2, minor: 2 };
    expect(axisFmtParam(fmt)).toEqual(fmt);
    expect(axisFmtParam({ mode: "auto", digits: 2 })).toBeUndefined();
    expect(sanitizeAxisExtras({ mode: "auto", digits: 2, minor: 99, divide: -1, ticks: "sideways" as never, size: 10 })).toEqual({ mode: "auto", digits: 2, size: 10 });
  });
});
