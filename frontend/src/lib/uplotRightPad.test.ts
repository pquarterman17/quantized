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

function rightPad(fontSize: number) {
  const opts = buildOpts(payload, { width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(), fontSize });
  const side = opts.padding?.[1];
  expect(typeof side, "right padding is computed from the drawn labels").toBe("function");
  return side as Exclude<uPlot.PaddingSide, number | null>;
}

describe("right padding holds the last x tick label", () => {
  it("leaves room for half a wide label at a large tick font", () => {
    const pad = rightPad(16);
    // "20,000" in 16 px monospace is ~58 px wide: half of it overhangs the frame by 29 px.
    expect(pad(plotWith(["-20,000", "0", "20,000"]), 1, [false, false, true, true], 1)).toBeGreaterThanOrEqual(29);
  });

  it("never pads less than uPlot's own default, and skips blank minor labels", () => {
    const pad = rightPad(12);
    expect(pad(plotWith(["0", "5", null]), 1, [false, false, true, true], 1)).toBe(25);
    expect(pad(plotWith([]), 1, [false, false, true, true], 0)).toBe(25);
  });

  it("adds nothing when a right y axis already holds the label", () => {
    expect(rightPad(16)(plotWith(["20,000"]), 1, [false, true, true, true], 1)).toBe(0);
  });
});

describe("x ticks are spaced by their drawn labels", () => {
  const spaceOf = (args: Partial<Parameters<typeof buildOpts>[1]>, p: PlotPayload = payload) => {
    const opts = buildOpts(p, { width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(), ...args });
    return opts.axes?.[0]?.space;
  };

  it("keeps a label-and-a-gap between ticks, never below uPlot's 50 px", () => {
    // Measured live: "-12,500" labels touched at uPlot's default 50 px, and a
    // zoom to "1.00005"-wide labels overlapped them.
    const space = spaceOf({ fontSize: 12 });
    expect(typeof space).toBe("function");
    const at = (vals: (string | null)[]) => (space as (u: uPlot) => number)(plotWith(vals));
    expect(at(["-15,000", "-12,500", "-10,000"])).toBeGreaterThanOrEqual(Math.ceil(9 * 12 * 0.6));
    expect(at(["0", "5", "10"])).toBe(50);
    expect(at([])).toBe(50);
  });

  it("leaves log and categorical x axes to their own tick rules", () => {
    expect(spaceOf({ xScale: "log" })).toBeUndefined();
    expect(spaceOf({}, { ...payload, xCategories: ["a", "b", "c"] })).toBeUndefined();
  });
});
