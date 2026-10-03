// Plot audit round 3: a non-monotonic-x line is drawn in runs short enough that
// uPlot never min/max-decimates it (decimation assumes ascending x). uPlot's
// `bbox.width` is in DEVICE pixels rounded to a half pixel, so at a fractional
// devicePixelRatio (Windows at 125 %/150 %) — or with a fractional padding —
// it is often x.5. The run length then came out fractional, every other run
// started at a fractional row index (`u.data[0][12.5]` is undefined), uPlot's
// non-null scan answered -1 and the run swept from row 0 past the decimation
// threshold: a 7-file VSM overlay drew all but the last loop as vertical bars.

import { describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";

const n = 2000;
// A field sweep up then back down: x is NOT ascending.
const xs = Array.from({ length: n }, (_, i) => (i < n / 2 ? i : n - i));
const loop: PlotPayload = {
  data: [xs, xs.map((x) => x * 2)],
  series: [{ label: "M", unit: "emu" }],
  xLabel: "Field",
  xUnit: "Oe",
};

function runsAt(width: number): [number, number][] {
  const runs: [number, number][] = [];
  const linearPaths = vi.fn((_u: unknown, _s: number, i0: number, i1: number) => {
    runs.push([i0, i1]);
    return { stroke: { addPath: vi.fn() } };
  });
  const opts = buildOpts(loop, {
    width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
    linearPaths: linearPaths as never,
  });
  const paths = (opts.series?.[1] as { paths: (u: unknown, si: number, i0: number, i1: number) => unknown }).paths;
  paths({ data: loop.data, bbox: { width } }, 1, 0, 0);
  return runs;
}

describe("a non-monotonic line's draw runs", () => {
  it.each([100, 100.5, 333.5])("tile every row with whole indices, each under the decimation threshold (bbox %s)", (width) => {
    const runs = runsAt(width);
    expect(runs.length).toBeGreaterThan(1);
    expect(runs[0][0]).toBe(0);
    expect(runs[runs.length - 1][1]).toBe(n - 1);
    runs.forEach(([i0, i1], k) => {
      expect(Number.isInteger(i0) && Number.isInteger(i1), `run ${k}: [${i0}, ${i1}]`).toBe(true);
      // uPlot decimates when idx1 - idx0 >= 4 x bbox.width.
      expect(i1 - i0).toBeLessThan(width * 4);
      if (k > 0) expect(i0).toBe(runs[k - 1][1]);
    });
  });
});

// uPlot breaks a line at a null by CLIPPING the x interval the null run spans,
// which assumes ascending x. On a loop that interval is wherever the sweep
// happened to be, so an overlay's block rows (every series null outside its own
// file's rows) cut holes into the curves that cross it. A loop breaks its line
// by not drawing across the null instead, and keeps no x clip.
describe("a non-monotonic line's gaps", () => {
  const ys: (number | null)[] = xs.map((x, i) => (i < 300 || i === 1200 ? null : x * 2));
  const block: PlotPayload = { ...loop, data: [xs, ys] };

  it("draws only across non-null rows, every one of them, and clips nothing", () => {
    const runs: [number, number][] = [];
    const linearPaths = vi.fn((_u: unknown, _s: number, i0: number, i1: number) => {
      runs.push([i0, i1]);
      return { stroke: { addPath: vi.fn() }, clip: "x-interval clip" };
    });
    const opts = buildOpts(block, {
      width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
      linearPaths: linearPaths as never,
    });
    const paths = (opts.series?.[1] as { paths: (u: unknown, si: number, i0: number, i1: number) => { clip?: unknown } }).paths;
    const out = paths({ data: [xs, ys], bbox: { width: 100.5 }, series: [{}, { scale: "y" }], scales: { y: { distr: 1 } } }, 1, 0, 0);
    expect(out.clip ?? null).toBeNull();
    const drawn = new Set<number>();
    for (const [i0, i1] of runs) {
      for (let i = i0; i <= i1; i++) {
        expect(ys[i], `row ${i} in run [${i0}, ${i1}]`).not.toBeNull();
        drawn.add(i);
      }
    }
    expect(drawn.size).toBe(ys.filter((y) => y !== null).length);
  });
});
