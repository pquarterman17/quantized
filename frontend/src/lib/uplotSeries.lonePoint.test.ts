// Bug hunt (live): a one-row file plotted as a blank canvas, and so did a value
// bracketed by Inf/NaN rows. A line joins at least two points and the default
// Line trace draws no markers, so an isolated point was never painted. Such a
// point (and only such a point) now gets a marker; ordinary lines are unchanged.

import { describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";
import { isolatedPoints } from "./uplotSeries";

const args = { width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn() } as const;
const payload = (y: (number | null)[]): PlotPayload => ({
  data: [y.map((_, i) => i + 1), y],
  series: [{ label: "y", unit: "" }],
  xLabel: "x",
  xUnit: "",
});
const idx = (y: (number | null)[]) => isolatedPoints({ data: payload(y).data } as never, 1);
const pointsOf = (p: PlotPayload) =>
  (buildOpts(p, args).series?.[1] as { points?: { show?: boolean; filter?: unknown } }).points;

describe("isolated points", () => {
  it("finds a lone point, at the ends or between gaps", () => {
    expect(idx([2])).toEqual([0]);
    expect(idx([null, 3, NaN])).toEqual([1]);
    expect(idx([2, Infinity, -Infinity, 4])).toEqual([0, 3]);
    expect(idx([1, 2, null, 5, null, 7, 8])).toEqual([3]);
  });
  it("finds none in a connected line", () => {
    expect(idx([1, 2])).toBeNull();
    expect(idx([1, 2, 3, null, 4, 5])).toBeNull();
    expect(idx([null, NaN])).toBeNull();
  });
  it("a Line series asks uPlot to mark them (show stays off: defaults unchanged)", () => {
    const pts = pointsOf(payload([2]));
    expect(pts?.show).toBe(false);
    expect(typeof pts?.filter).toBe("function");
  });
});
