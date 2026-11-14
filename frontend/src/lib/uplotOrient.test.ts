import { describe, expect, it } from "vitest";
import type uPlot from "uplot";

import { hasHorizontalBars, orientAxes } from "./uplotOrient";

const scales: uPlot.Scales = { x: { dir: 1 }, y: { distr: 3 }, y2: {} };
const sizeY = () => 70;
const axes: uPlot.Axis[] = [{ size: 50, label: "X" }, { size: sizeY, label: "Y" }, { scale: "y2", side: 1 }];

describe("orientAxes (an Origin horizontal bar graph turns the plot on its side)", () => {
  it("leaves an ordinary plot exactly as built", () => {
    for (const styles of [undefined, [], [{ bars: true }], [undefined, { color: "red" }]]) {
      const out = orientAxes(scales, axes, styles);
      expect(out.scales).toBe(scales);
      expect(out.axes).toBe(axes);
    }
  });

  it("puts X up the left side and Y along the bottom, keeping each scale's own settings", () => {
    expect(hasHorizontalBars([undefined, { bars: "horizontal" }])).toBe(true);
    const out = orientAxes(scales, axes, [{ bars: "horizontal" }]);
    expect(out.scales).toEqual({ x: { dir: 1, ori: 1 }, y: { distr: 3, ori: 0 }, y2: { ori: 0 } });
    expect(out.axes[0]).toMatchObject({ label: "X", side: 3, size: sizeY }); // the measured gutter
    expect(out.axes[1]).toMatchObject({ label: "Y", side: 2, size: 50 }); // the band height
    expect(out.axes[2]).toMatchObject({ scale: "y2", side: 0 });
    expect(scales.x).toEqual({ dir: 1 }); // inputs untouched
  });
});
