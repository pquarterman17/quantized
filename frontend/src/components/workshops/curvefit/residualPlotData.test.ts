// Residual plot payloads (audit #7): scatter panels are sorted by their
// abscissa (uPlot needs ascending x) without losing a point of a
// non-monotonic X, non-finite rows drop out, the histogram counts every
// residual once, and the Q-Q panel waits for its pairs.

import { describe, expect, it } from "vitest";

import { binCount, histogram, residualPlots } from "./residualPlotData";

describe("residualPlots", () => {
  it("sorts residual vs X by X, keeping every point of a non-monotonic X", () => {
    const x = [0, 2, 1, 2, 0];
    const r = [0.1, -0.2, 0.3, 0.4, -0.5];
    const p = residualPlots(x, [1, 2, 3, 4, 5], r, "H (Oe)");
    expect(p.vsX.data[0]).toEqual([0, 0, 1, 2, 2]);
    expect([...(p.vsX.data[1] as number[])].sort()).toEqual([...r].sort());
    expect(p.vsX.xLabel).toBe("H (Oe)");
    expect(p.vsX.series[0]!.kind).toBe("points");
    expect(p.qq).toBeNull();
  });

  it("plots residual against the fitted value and drops null rows", () => {
    const p = residualPlots([0, 1, 2], [3, null, 1], [0.1, 0.2, null], "x");
    expect(p.vsFitted.data).toEqual([[3], [0.1]]);
  });

  it("builds the Q-Q panel from the diagnostics pairs", () => {
    const p = residualPlots([0, 1], [1, 2], [0.1, -0.1], "x", { qqX: [-1, 1], qqY: [-0.1, 0.1] });
    expect(p.qq?.data).toEqual([[-1, 1], [-0.1, 0.1]]);
  });
});

describe("histogram", () => {
  it("counts every value once, the maximum in the last bin", () => {
    const h = histogram([0, 0.1, 0.5, 0.9, 1], 2);
    expect(h.edges).toEqual([0, 0.5, 1]);
    expect(h.counts).toEqual([2, 3]);
  });

  it("widens a constant sample so it still has a bin", () => {
    expect(histogram([2, 2, 2], 1)).toEqual({ edges: [1.5, 2.5], counts: [3] });
    expect(histogram([])).toEqual({ edges: [], counts: [] });
    expect(binCount(100)).toBe(8);
  });

  it("draws the outline as one stepped line from zero", () => {
    const p = residualPlots([0, 1, 2, 3], [0, 0, 0, 0], [0, 0, 1, 1], "x");
    expect((p.histogram.data[1] as number[]).slice(0, 4)).toEqual([0, 2, 2, 0]);
  });
});
