// Plot audit round 2: the right-most x tick label was clipped at the canvas
// edge ("20,0", "3,75(") — uPlot's automatic right padding is a fixed 25 px
// (half its default y-axis size), narrower than half a wide label.
import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";

const payload: PlotPayload = {
  data: [[-20000, 0, 20000], [1, 2, 3]] as PlotPayload["data"],
  series: [{ label: "M", unit: "emu" }],
  xLabel: "Field",
  xUnit: "Oe",
};

/** A uPlot stand-in after an axes pass: the x axis' drawn tick strings. */
const plotWith = (values: (string | null)[]): uPlot => ({ axes: [{ _values: values }] }) as unknown as uPlot;

function rightPad(fontSize: number, p: PlotPayload = payload) {
  const opts = buildOpts(p, { width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(), fontSize });
  return opts.padding?.[1];
}

describe("right padding holds the last x tick label", () => {
  it("leaves room for half a 7-character label at a large tick font", () => {
    // "-20,000" in 16 px monospace is ~67 px wide: half of it overhangs the frame by ~34 px.
    expect(rightPad(16)).toBeGreaterThanOrEqual(34);
    expect(rightPad(12)).toBeGreaterThanOrEqual(Math.ceil((7 * 12 * 0.6) / 2));
  });

  it("is a fixed number, not a function uPlot would re-converge its layout on", () => {
    // Measured: a padding function broke a 7-file VSM overlay (block rows,
    // non-monotonic x) — every series but the last drew as a vertical line.
    expect(typeof rightPad(12)).toBe("number");
  });

  it("never pads less than uPlot's own default", () => {
    expect(rightPad(9)).toBe(25);
  });

  it("leaves a right y axis to uPlot, whose gutter already holds the label", () => {
    const withY2: PlotPayload = { ...payload, data: [...payload.data, [3, 2, 1]] as PlotPayload["data"], series: [...payload.series, { label: "T", unit: "K", axis: 1 }] };
    expect(rightPad(16, withY2)).toBeNull();
  });
});

describe("x ticks are spaced by their drawn labels", () => {
  const spaceOf = (args: Partial<Parameters<typeof buildOpts>[1]>, p: PlotPayload = payload) => {
    const opts = buildOpts(p, { width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(), ...args });
    return opts.axes?.[0]?.space;
  };

  // (u, axisIdx, scaleMin, scaleMax, plotDim): -20,000..20,000 across 600 px.
  const at = (space: unknown, vals: (string | null)[]) => (space as (...a: unknown[]) => number)(plotWith(vals), 0, -20000, 20000, 600);

  it("keeps a label-and-a-gap between ticks, never closer than the auto density rule", () => {
    // Measured live: "-12,500" labels touched at uPlot's default 50 px, and a
    // zoom to "1.00005"-wide labels overlapped them.
    const space = spaceOf({ fontSize: 12 });
    expect(typeof space).toBe("function");
    expect(at(space, ["-123,456,789", "-12,500"])).toBeGreaterThanOrEqual(Math.ceil(14 * 12 * 0.6));
    // Audit 6 P3 (deliberate): short labels no longer fall back to uPlot's
    // 50 px but to matplotlib's AutoLocator (lib/uplotRightPad.ts): 600 px at
    // a 12 px font is 9 bins, and 40,000 / 9 rounds up to a 5,000 step: 75 px.
    expect(at(space, ["0", "5", "10"])).toBeCloseTo(75, 3);
    expect(at(space, [])).toBeCloseTo(75, 3);
  });

  it("keeps uPlot's 50 px floor on a date x axis", () => {
    expect(at(spaceOf({ fontSize: 12, xFmt: { mode: "date", digits: 0 } }), ["0", "5"])).toBe(50);
  });

  it("leaves log and categorical x axes to their own tick rules", () => {
    expect(spaceOf({ xScale: "log" })).toBeUndefined();
    expect(spaceOf({}, { ...payload, xCategories: ["a", "b", "c"] })).toBeUndefined();
  });
});
