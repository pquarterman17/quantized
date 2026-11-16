// lib/uplotLoopLine.ts: the stroke of a non-monotonic-x line. A 100k-row file
// with rows in no x order took about 3 minutes from drop to first paint
// (2026-11-16, headless Chromium), all of it canvas raster of a stroke with a
// vertex per row. These pin the two rules that bound it, by what is drawn
// (pixels, vertex counts, stroke width), not by time: the pixels of an
// ordinary loop are unchanged, a dense loop emits about one vertex per pixel
// it crosses, and only a line that buries every cell it touches goes one
// pixel wide. The before-the-chunk path is in
// Stage/loopLineStartupChunk.race.test.tsx.

import { createCanvas } from "@napi-rs/canvas";
import type uPlot from "uplot";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "./plotdata";
import { regionDecorSettled } from "./regionDecorLoader";
import { buildOpts } from "./uplotOpts";
import { BURIED_FRACTION, SATURATED_COVERAGE, SPREAD_CELL, buried, loopInk, strokeRows, type LoopInk } from "./uplotLoopLine";

beforeAll(() => regionDecorSettled);
afterEach(() => vi.unstubAllGlobals());

const W = 600;
const H = 400;
const LEFT = 40;
const TOP = 20;

/** The slice of a uPlot instance the loop stroke reads: x and y map linearly
 *  onto a W x H plot box at (LEFT, TOP), in device px. */
function fakePlot(xs: number[], ys: (number | null)[], opts: { ori?: 0 | 1; dir?: 1 | -1; width?: number } = {}) {
  const ext = (v: (number | null)[]) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of v) {
      if (n == null) continue;
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
    }
    return [lo, hi] as const;
  };
  const [x0, x1] = ext(xs);
  const [y0, y1] = ext(ys);
  const ori = opts.ori ?? 0;
  const dir = opts.dir ?? 1;
  const valToPos = vi.fn((v: number, key: string) => {
    const isX = key === "x";
    let t = isX ? (v - x0) / (x1 - x0) : (v - y0) / (y1 - y0);
    if (isX && dir === -1) t = 1 - t;
    // The x scale runs across the box (down it when turned); y the other way.
    const across = isX === (ori === 0);
    return across ? LEFT + t * W : TOP + H - t * H;
  });
  return {
    data: [xs, ys],
    bbox: { left: LEFT, top: TOP, width: W, height: H },
    series: [{ scale: "x" }, { scale: "y", width: opts.width ?? 1.5, pxRound: Math.round }],
    scales: { x: { ori, dir }, y: { ori: ori === 0 ? 1 : 0, dir: 1, distr: 1 } },
    valToPos,
  };
}
type Fake = ReturnType<typeof fakePlot>;
const asU = (u: Fake) => u as unknown as uPlot;

/** A stand-in for uPlot's linear builder: a fill, an x clip, and a run log. */
const builder = () => vi.fn((_u: unknown, _s: number, _i0: number, _i1: number) => ({ stroke: new Path2D(), fill: null, clip: "x clip", band: null }));

type Paths = uPlot.Series.Paths & { _width?: number };
/** The line path `buildOpts` gives a non-monotonic series, drawn on `u`. */
function draw(u: Fake, b = builder()): Paths {
  const payload: PlotPayload = { data: u.data as PlotPayload["data"], series: [{ label: "y", unit: "" }], xLabel: "x", xUnit: "" };
  const opts = buildOpts(payload, {
    width: W, height: H, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(), linearPaths: b as never,
  });
  const paths = (opts.series?.[1] as { paths: uPlot.Series.PathBuilder }).paths;
  return paths(asU(u), 1, 0, 0) as Paths;
}

function prng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
function gauss(rnd: () => number) {
  return Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
}

/** Field swept up and back `laps` times: a hysteresis loop of n rows. */
function loop(n: number, laps: number, noise = 0) {
  const rnd = prng(7);
  const xs = Array.from({ length: n }, (_, i) => Math.sin((i / n) * 2 * Math.PI * laps));
  const ys = xs.map((_, i) => Math.tanh(3 * Math.sin((i / n) * 2 * Math.PI * laps + 0.3)) + noise * (rnd() - 0.5));
  return { xs, ys };
}
/** Rows uniform over a square, in no order. */
function uniform(n: number) {
  const rnd = prng(11);
  return { xs: Array.from({ length: n }, rnd), ys: Array.from({ length: n }, rnd) };
}
/** Rows from a 2-D normal, in no order: dense middle, sparse edges. */
function gaussian(n: number) {
  const rnd = prng(13);
  return { xs: Array.from({ length: n }, () => gauss(rnd)), ys: Array.from({ length: n }, () => gauss(rnd)) };
}
/** A 2-D Ornstein-Uhlenbeck walk: each row a step from the last. */
function ou(n: number, a: number) {
  const rnd = prng(17);
  const xs = [0];
  const ys = [0];
  for (let i = 1; i < n; i++) {
    xs.push((1 - a) * xs[i - 1]! + gauss(rnd));
    ys.push((1 - a) * ys[i - 1]! + gauss(rnd));
  }
  return { xs, ys };
}

/** An ink whose path counts what it receives. */
function countingInk(u: Fake): LoopInk & { path: { moveTo: ReturnType<typeof vi.fn>; lineTo: ReturnType<typeof vi.fn> } } {
  return { ...loopInk(asU(u)), path: { moveTo: vi.fn(), lineTo: vi.fn() } } as never;
}

/** Stroke `path` on a fresh canvas and return its pixels. */
function render(path: Path2D, width = 1.5): Uint8ClampedArray {
  const c = createCanvas(LEFT + W + 20, TOP + H + 20);
  const ctx = c.getContext("2d");
  ctx.lineWidth = width;
  ctx.strokeStyle = "#3366ff";
  ctx.stroke(path as never);
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

describe("a loop's stroke", () => {
  it("draws the same pixels as a vertex per row (same-pixel vertices dropped)", () => {
    const { xs, ys } = loop(20_000, 3, 0.002);
    const u = fakePlot(xs, ys);
    const ours = draw(u).stroke as Path2D;
    // What uPlot's linear builder stroked: every row, rounded, one subpath per run.
    const run = Math.ceil(W * 4) - 1;
    const every = new Path2D();
    for (let i = 0; i < xs.length - 1; i += run) {
      for (let k = i; k <= Math.min(xs.length - 1, i + run); k++) {
        const x = Math.round(u.valToPos(xs[k]!, "x"));
        const y = Math.round(u.valToPos(ys[k]!, "y"));
        if (k === i) every.moveTo(x, y);
        else every.lineTo(x, y);
      }
    }
    const a = render(ours);
    const b = render(every);
    let differ = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++;
    expect(differ).toBe(0);
    expect(a.some((v) => v > 0)).toBe(true); // something was drawn
  });

  it("emits about one vertex per pixel crossed for a dense loop, never one per row", () => {
    const n = 100_000;
    const { xs, ys } = loop(n, 20);
    const u = fakePlot(xs, ys);
    const ink = countingInk(u);
    strokeRows(asU(u), 1, 0, n - 1, ink);
    const vertices = ink.path.moveTo.mock.calls.length + ink.path.lineTo.mock.calls.length;
    // 20 laps of a curve about 2 x (W + H) px long: well under one vertex per row.
    expect(vertices).toBeLessThan(n / 2);
    expect(vertices).toBeGreaterThan(1000);
  });

  it("maps each row once and asks the builder once, however many rows (no per-row builder work)", () => {
    for (const n of [10_000, 100_000]) {
      const { xs, ys } = uniform(n);
      const u = fakePlot(xs, ys);
      const b = builder();
      draw(u, b);
      // Each row once, plus the row two neighbouring runs share (runs < 4 rows/px).
      const shared = Math.ceil((n - 1) / (Math.ceil(W * 4) - 1)) - 1;
      expect(u.valToPos).toHaveBeenCalledTimes(2 * (n + shared));
      expect(b).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps the first run's fill and band but never its x-interval clip", () => {
    const { xs, ys } = loop(5000, 2);
    const out = draw(fakePlot(xs, ys));
    expect(out.clip).toBeNull();
    expect(out.fill).toBeNull();
  });

  it("joins across an x the axis cannot place, as canvas did with uPlot's lineTo(NaN)", () => {
    const u = fakePlot([0, 1, 2, 3], [0, 1, 2, 3]);
    u.valToPos.mockImplementation((v: number, key: string) => (key === "x" && v === 2 ? NaN : LEFT + v * 10));
    const ink = countingInk(u);
    strokeRows(asU(u), 1, 0, 3, ink);
    expect(ink.path.moveTo).toHaveBeenCalledTimes(1);
    expect(ink.path.lineTo).toHaveBeenCalledTimes(2); // 0 -> 1 -> 3
  });

  it("walks a reversed x backwards within a run, as uPlot's builder does (dash phase)", () => {
    const u = fakePlot([0, 1, 2], [0, 1, 2], { dir: -1 });
    const ink = countingInk(u);
    strokeRows(asU(u), 1, 0, 2, ink);
    // Row 2 first: x=2 sits at the LEFT edge on a reversed axis.
    expect(ink.path.moveTo).toHaveBeenCalledWith(LEFT, TOP);
  });

  it("lays a turned plot's x down the canvas, as uPlot's lineToV does", () => {
    const u = fakePlot([0, 1], [0, 1], { ori: 1 });
    const ink = countingInk(u);
    strokeRows(asU(u), 1, 0, 1, ink);
    // A turned x runs backwards (uPlot: dir * -1): row 1 first, x=1 at the bottom.
    expect(ink.path.moveTo).toHaveBeenCalledWith(LEFT + W, TOP);
    expect(ink.path.lineTo).toHaveBeenCalledWith(LEFT, TOP + H);
  });

  it("counts only the length inside the plot box toward coverage", () => {
    const u = fakePlot([0, 1, 2], [0, 1, 2]);
    // Row 0 far off to the left (zoomed in), rows 1 and 2 on screen 10 px apart.
    u.valToPos.mockImplementation((v: number, key: string) => (key === "x" ? (v === 0 ? -5000 : LEFT + v * 10) : TOP + 5));
    const ink = countingInk(u);
    strokeRows(asU(u), 1, 0, 2, ink);
    // 10 px of the long segment lies inside the box, plus the 10-px one; the
    // long one is sampled every half cell, so its share is good to a sample.
    const total = ink.cells.reduce((s, v) => s + v, 0);
    expect(total).toBeGreaterThan(20 - SPREAD_CELL / 2);
    expect(total).toBeLessThan(20 + SPREAD_CELL / 2);
  });
});

describe("the one-pixel stroke of a buried plot", () => {
  it("applies to rows in no x order spread evenly over the plot", () => {
    const { xs, ys } = uniform(100_000);
    expect(draw(fakePlot(xs, ys))._width).toBe(1);
  });

  it("round-trips to one device pixel on a HiDPI display", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { xs, ys } = uniform(100_000);
    const out = draw(fakePlot(xs, ys));
    // uPlot strokes roundDec(_width * pxRatio): one device pixel.
    expect(out._width! * 2).toBe(1);
  });

  // Each of these is dense somewhere but has cells it does not bury (the
  // reviewer measured 17-20k pixels changing on the clouds, about half the
  // plot inked), so a thinner stroke would visibly thin them.
  it.each([
    ["a Gaussian cloud", () => gaussian(100_000)],
    ["an OU walk, a = 0.1", () => ou(100_000, 0.1)],
    ["an OU walk, a = 0.5", () => ou(100_000, 0.5)],
    ["a clean loop retraced 40 times", () => loop(200_000, 40)],
    ["a noisy band retraced 40 times", () => loop(200_000, 40, 0.05)],
  ])("does not apply to %s", (_name, make) => {
    const { xs, ys } = make();
    expect(draw(fakePlot(xs, ys))._width).toBeUndefined();
  });

  it("does not apply to a stroke already one pixel wide, or to a sparse cloud", () => {
    const { xs, ys } = uniform(100_000);
    expect(draw(fakePlot(xs, ys, { width: 1 }))._width).toBeUndefined();
    const few = uniform(500);
    expect(draw(fakePlot(few.xs, few.ys))._width).toBeUndefined();
  });

  it("needs nearly every touched cell buried, not a buried total", () => {
    const full = (SATURATED_COVERAGE * SPREAD_CELL * SPREAD_CELL) / 1.5;
    const ink = (deep: number, shallow: number): LoopInk => ({
      path: new Path2D(), cols: 10,
      cells: Float32Array.from({ length: 100 }, (_, i) => (i < deep ? full * 50 : i < deep + shallow ? 1 : 0)),
    });
    expect(buried(ink(95, 5), 1.5)).toBe(95 >= BURIED_FRACTION * 100);
    expect(buried(ink(50, 50), 1.5)).toBe(false); // a huge total in half the cells
    expect(buried(ink(100, 0), 1)).toBe(false);
  });
});
