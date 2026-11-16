// lib/uplotLoopLine.ts: the stroke of a non-monotonic-x line. A 100k-row file
// with rows in no x order took about 3 minutes from drop to first paint
// (2026-11-16, headless Chromium), all of it canvas raster of a stroke with a
// vertex per row. These pin the two rules that bound it, by what is drawn
// (pixels, vertex counts, stroke width), not by time: the pixels of an
// ordinary loop are unchanged, a dense loop emits about one vertex per pixel
// it crosses, and only a line that buries its whole plot goes one pixel wide.

import { createCanvas } from "@napi-rs/canvas";
import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import { SATURATED_COVERAGE, fullLine, saturated, strokeRows, strokeTally } from "./uplotLoopLine";

const W = 600;
const H = 400;
const LEFT = 40;
const TOP = 20;

/** The slice of a uPlot instance the loop stroke reads: x and y map linearly
 *  onto a W x H plot box at (LEFT, TOP), in device px. */
function fakePlot(xs: number[], ys: (number | null)[], opts: { ori?: 0 | 1; width?: number } = {}) {
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
  const valToPos = vi.fn((v: number, key: string) => {
    const isX = key === "x";
    const t = isX ? (v - x0) / (x1 - x0) : (v - y0) / (y1 - y0);
    // The x scale runs across the box (down it when turned); y the other way.
    const across = isX === (ori === 0);
    return across ? LEFT + t * W : TOP + H - t * H;
  });
  return {
    data: [xs, ys],
    bbox: { left: LEFT, top: TOP, width: W, height: H },
    series: [{ scale: "x" }, { scale: "y", width: opts.width ?? 1.5, pxRound: Math.round }],
    scales: { x: { ori }, y: { ori: ori === 0 ? 1 : 0, distr: 1 } },
    valToPos,
  };
}

/** A stand-in for uPlot's linear builder: the first run's fill and band. */
const builder = () => vi.fn(() => ({ stroke: new Path2D(), fill: null, clip: "x clip", band: null }));

type Paths = uPlot.Series.Paths & { _width?: number };
const draw = (u: ReturnType<typeof fakePlot>, b = builder()): Paths =>
  fullLine(b as never, true)(u as unknown as uPlot, 1, 0, 0) as Paths;

/** Field swept up and back `laps` times: a hysteresis loop of n rows. */
function loop(n: number, laps: number, noise = 0) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const xs = Array.from({ length: n }, (_, i) => Math.sin((i / n) * 2 * Math.PI * laps));
  const ys = xs.map((_, i) => Math.tanh(3 * Math.sin((i / n) * 2 * Math.PI * laps + 0.3)) + noise * rnd());
  return { xs, ys };
}

function random(n: number) {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return { xs: Array.from({ length: n }, rnd), ys: Array.from({ length: n }, rnd) };
}

/** Counts what a stroke receives. */
function countingPath() {
  const p = { moveTo: vi.fn(), lineTo: vi.fn(), addPath: vi.fn() };
  return p;
}

/** Stroke `path` 1.5 px wide on a fresh canvas and return its pixels. */
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
    const p = countingPath();
    const t = strokeTally(u as unknown as uPlot);
    strokeRows(u as unknown as uPlot, 1, 0, n - 1, p as unknown as Path2D, t);
    const vertices = p.moveTo.mock.calls.length + p.lineTo.mock.calls.length;
    // 20 laps of a curve about 2 x (W + H) px long: well under one vertex per row.
    expect(vertices).toBeLessThan(n / 2);
    expect(vertices).toBeGreaterThan(1000);
  });

  it("maps each row once and asks the builder once, however many rows (no per-row builder work)", () => {
    for (const n of [10_000, 100_000]) {
      const { xs, ys } = random(n);
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

  it("does not draw across a null: it starts a new subpath after one", () => {
    const xs = [0, 1, 2, 1, 0, 1, 2];
    const ys = [0, 1, null, 3, 4, 5, 6];
    const u = fakePlot(xs, ys);
    const p = countingPath();
    const t = strokeTally(u as unknown as uPlot);
    strokeRows(u as unknown as uPlot, 1, 0, 1, p as unknown as Path2D, t);
    strokeRows(u as unknown as uPlot, 1, 3, 6, p as unknown as Path2D, t);
    expect(p.moveTo).toHaveBeenCalledTimes(2);
    expect(p.lineTo).toHaveBeenCalledTimes(4);
  });

  it("breaks the line at an x the axis cannot place (a log x at x <= 0)", () => {
    const u = fakePlot([0, 1, 2, 3], [0, 1, 2, 3]);
    u.valToPos.mockImplementation((v: number, key: string) => (key === "x" && v === 2 ? NaN : LEFT + v * 10));
    const p = countingPath();
    strokeRows(u as unknown as uPlot, 1, 0, 3, p as unknown as Path2D, strokeTally(u as unknown as uPlot));
    expect(p.moveTo).toHaveBeenCalledTimes(2); // rows 0 and 3 start subpaths
    expect(p.lineTo).toHaveBeenCalledTimes(1); // only 0 -> 1
  });

  it("counts only the length inside the plot box toward coverage", () => {
    const u = fakePlot([0, 1, 2], [0, 1, 2]);
    // Row 0 far off to the left (zoomed in), rows 1 and 2 on screen 10 px apart.
    u.valToPos.mockImplementation((v: number, key: string) => (key === "x" ? (v === 0 ? -5000 : LEFT + v * 10) : TOP + 5));
    const t = strokeTally(u as unknown as uPlot);
    strokeRows(u as unknown as uPlot, 1, 0, 2, countingPath() as unknown as Path2D, t);
    expect(t.len).toBe(10);
  });

  it("lays a turned plot's x down the canvas, as uPlot's lineToV does", () => {
    const u = fakePlot([0, 1], [0, 1], { ori: 1 });
    const p = countingPath();
    strokeRows(u as unknown as uPlot, 1, 0, 1, p as unknown as Path2D, strokeTally(u as unknown as uPlot));
    // Row 0: x=0 at the top of the box (y px), y=0 at its left (x px).
    expect(p.moveTo).toHaveBeenCalledWith(LEFT, TOP + H);
    expect(p.lineTo).toHaveBeenCalledWith(LEFT + W, TOP);
  });
});

describe("the one-pixel stroke of a buried plot", () => {
  it("applies to rows in no x order that cover the plot many times over", () => {
    const { xs, ys } = random(100_000);
    const out = draw(fakePlot(xs, ys));
    expect(out._width).toBe(1 / (globalThis.devicePixelRatio || 1));
  });

  it("does not apply to a loop, even a dense noisy band retraced many times", () => {
    for (const noise of [0, 0.05]) {
      const { xs, ys } = loop(200_000, 40, noise);
      const out = draw(fakePlot(xs, ys));
      expect(out._width, `noise ${noise}`).toBeUndefined();
    }
  });

  it("does not apply to a stroke already one pixel wide, or to a sparse cloud", () => {
    const { xs, ys } = random(100_000);
    expect(draw(fakePlot(xs, ys, { width: 1 }))._width).toBeUndefined();
    const few = random(500);
    expect(draw(fakePlot(few.xs, few.ys))._width).toBeUndefined();
  });

  it("needs both the coverage and the spread", () => {
    const t = { len: 0, cells: new Uint8Array(100), cols: 10, touched: 0 };
    const area = 10_000;
    t.len = (SATURATED_COVERAGE * area) / 1.5;
    expect(saturated({ ...t, touched: 10 }, 1.5, area)).toBe(false);
    expect(saturated({ ...t, touched: 50 }, 1.5, area)).toBe(true);
    expect(saturated({ ...t, len: t.len / 2, touched: 100 }, 1.5, area)).toBe(false);
  });
});
