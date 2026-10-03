// Plot audit round 4, measured on a SIMS depth profile: plotting H, C and O
// (first point at 0.87 nm) from a sheet whose Al column starts at 0 nm drew
// the x axis from 0, a blank band the export (matplotlib autoscales to the
// drawn points) does not have. uPlot ranges an ascending x over the whole
// column; rows where no plotted series has a value now stay out of it (the
// scanned range, padded 2% as a loop's is).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  class NoopPath {
    moveTo() {}
    lineTo() {}
    addPath() {}
    rect() {}
    arc() {}
    closePath() {}
    bezierCurveTo() {}
  }
  (globalThis as { Path2D?: unknown }).Path2D = NoopPath;
  const mq = { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  window.matchMedia ??= (() => mq) as unknown as typeof window.matchMedia;
});

import uPlot from "uplot";

import type { PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";
import { fullXExtents } from "./uplotXRange";

const live: uPlot[] = [];
afterEach(() => live.splice(0).forEach((u) => u.destroy()));

const payload = (ys: (number | null)[][]): PlotPayload => ({
  data: [[0, 0.87, 1.7, 2.5, 3.3], ...ys] as PlotPayload["data"],
  series: ys.map((_, i) => ({ label: `s${i}`, unit: "" })),
  xLabel: "Depth",
  xUnit: "nm",
});

async function xRange(p: PlotPayload, hidden?: boolean[]): Promise<[number, number]> {
  const opts = buildOpts(p, {
    width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom",
    onReadout: () => {}, linearPaths: uPlot.paths.linear!(), hidden,
  });
  const u = new uPlot(opts, p.data, document.body.appendChild(document.createElement("div")));
  live.push(u);
  await new Promise((r) => setTimeout(r, 0));
  return [u.scales.x.min!, u.scales.x.max!];
}

describe("x autoscale over the drawn rows", () => {
  it("leaves out leading and trailing rows no plotted series draws", async () => {
    const [lo, hi] = await xRange(payload([[null, 1, 2, 3, null], [null, 4, null, 6, null]]));
    expect(lo).toBeCloseTo(0.87 - 1.63 * 0.02, 9);
    expect(hi).toBeCloseTo(2.5 + 1.63 * 0.02, 9);
  });

  it("keeps uPlot's own range when the ends are drawn", async () => {
    expect(await xRange(payload([[1, null, 2, null, 3]]))).toEqual([0, 3.3]);
  });

  it("counts only visible series, as the export draws only those", () => {
    const [lo, hi] = fullXExtents(payload([[null, 1, 2, null, null], [5, 5, 5, 5, 5]]), [false, true], false)!;
    expect([lo, hi].map((v) => +v.toFixed(4))).toEqual([0.8534, 1.7166]);
  });
});
