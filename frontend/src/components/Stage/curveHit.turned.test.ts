// hitTest on a TURNED plot (horizontal bars / Exchange X-Y): X is the vertical
// scale, so the cursor's data coordinates, the nearest series and the axis zone
// are read along the turned geometry (the right-click menu's "Add text here" and
// nearest-curve header depend on it).
import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { hitTest, pointNear } from "./curveHit";

/** A 400 x 300 plot area at (100, 50); X (vertical, 0..100 up) and Y (horizontal, 0..1000). */
function fakePlot(turned: boolean): uPlot {
  const W = 400;
  const H = 300;
  const posX = (v: number) => (turned ? H - (v / 100) * H : (v / 100) * W);
  const posY = (v: number) => (turned ? (v / 1000) * W : H - (v / 1000) * H);
  const valX = (p: number) => (turned ? ((H - p) / H) * 100 : (p / W) * 100);
  const valY = (p: number) => (turned ? (p / W) * 1000 : ((H - p) / H) * 1000);
  return {
    over: { getBoundingClientRect: () => ({ left: 100, top: 50, right: 500, bottom: 350 }) },
    scales: { x: { ori: turned ? 1 : 0 }, y: { ori: turned ? 0 : 1 } },
    data: [[0, 25, 50, 75, 100], [100, 250, 500, 750, 900], [900, 750, 500, 250, 100]],
    series: [{}, { scale: "y" }, { scale: "y" }],
    posToVal: (p: number, s: string) => (s === "x" ? valX(p) : valY(p)),
    valToPos: (v: number, s: string) => (s === "x" ? posX(v) : posY(v)),
  } as unknown as uPlot;
}

describe("hitTest on a turned plot", () => {
  it("reads X up the side and Y along the bottom for the cursor's data position", () => {
    // 100 px right of the left edge and 75 px below the top: Y = 250, X = 75
    const h = hitTest(fakePlot(true), 200, 125, [1, 2], undefined, false, 44);
    expect(h.dataX).toBeCloseTo(75);
    expect(h.dataY).toBeCloseTo(250);
    const up = hitTest(fakePlot(false), 200, 125, [1, 2], undefined, false, 44);
    expect(up.dataX).toBeCloseTo(25); // upright: 100 px across = 25 % of X
  });

  it("picks the nearest series by horizontal distance, at the row nearest the cursor's X", () => {
    // cursor at X = 50 (row 2, vertical middle), Y = 480 -> series 1 (500) beats series 2 (500) tie -> first
    const near = hitTest(fakePlot(true), 100 + 0.49 * 400, 50 + 150, [1, 2], undefined, false, 44);
    expect(near.idx).toBe(2);
    expect(near.series).not.toBeNull();
    // far from both curves along Y: nothing
    const far = hitTest(fakePlot(true), 100 + 0.05 * 400, 50 + 150, [1, 2], undefined, false, 20);
    expect(far.series).toBeNull();
  });

  it("names the gutters by the axis drawn there", () => {
    const u = fakePlot(true);
    expect(hitTest(u, 300, 380, [1], undefined, false, 44).zone).toBe("y"); // below
    expect(hitTest(u, 60, 200, [1], undefined, false, 44).zone).toBe("x"); // left
    expect(hitTest(u, 300, 20, [1], undefined, true, 44).zone).toBe("y2"); // top
    expect(hitTest(u, 540, 200, [1], undefined, true, 44).zone).toBe("outside"); // right
  });

  it("pointNear matches a point by its turned position", () => {
    const u = fakePlot(true);
    const payload = { data: u.data, series: [{ label: "A", unit: "" }, { label: "B", unit: "" }] } as never;
    // series 1 row 2 = (X 50, Y 500): pixel (100 + 200, 50 + 150)
    const hit = pointNear(u, 100 + 200, 50 + 150, payload, [1, 2], null, null);
    expect(hit).not.toBeNull();
  });
});
