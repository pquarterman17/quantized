// Gap audit 4 G17: the canvas half of the log2 / probability / custom-tick /
// axis-crossing contract. tests/fixtures/wire/axis_scales.json is built by
// tests/test_axis_scales.py from the REAL matplotlib export; every number the
// screen computes here must match it, so screen and export agree.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import type { AxisExtrasContext } from "./axisBreakExtras";
import { applyAxisExtras } from "./axisExtras";
import type { AxisFormat } from "./axisFormat";
import {
  crossPosition, customTicksIn, drawableOn, log2Label, log2Ticks, plainLabel,
  probAutoRange, probBackward, probForward, probTicks, type ProbUnit,
} from "./axisScales";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/wire/axis_scales.json");

interface ExportCase {
  name: string;
  x: number[];
  y: number[];
  x_fmt?: AxisFormat;
  y_fmt?: AxisFormat;
  x_scale?: string;
  y_scale?: string;
  view?: [number, number];
  x_view?: [number, number];
  y_view?: [number, number];
  axis: "x" | "y";
  lim: [number, number];
  ticks: number[];
  labels: string[];
  crossFraction?: number;
}

const fx = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  prob: { unit: ProbUnit; data: [number, number] | null; autoRange: [number, number]; ticks: number[]; labels: string[]; samples: number[]; forward: (number | null)[]; backward: number[] }[];
  log2: { view: [number, number]; ticks: number[]; labels: string[] }[];
  custom: { custom: { at: number[]; labels?: string[] }; scale: string; fmt: AxisFormat; view: [number, number]; at: number[]; labels: (string | null)[] }[];
  cross: { cross: number; view: [number, number]; drawable: boolean; position: number | null }[];
  export: ExportCase[];
};

const close = (got: readonly number[], want: readonly number[]) => {
  expect(got.length).toBe(want.length);
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));
};

describe("axis_scales.json: the shared math", () => {
  it.each(fx.prob)("probability $unit over $data", (c) => {
    close(probAutoRange(c.data?.[0] ?? null, c.data?.[1] ?? null, c.unit), c.autoRange);
    const ticks = probTicks(c.autoRange[0], c.autoRange[1], c.unit);
    close(ticks, c.ticks);
    expect(ticks.map(plainLabel)).toEqual(c.labels);
    c.samples.forEach((v, i) => {
      const want = c.forward[i];
      if (want === null) expect(probForward(v, c.unit)).toBeNaN();
      else expect(probForward(v, c.unit)).toBeCloseTo(want, 8);
    });
    close(c.samples.slice(0, 3).map((v) => probBackward(probForward(v, c.unit), c.unit)), c.backward);
  });

  it.each(fx.log2)("log2 over $view", (c) => {
    const ticks = log2Ticks(c.view[0], c.view[1]);
    close(ticks, c.ticks);
    expect(ticks.map(log2Label)).toEqual(c.labels);
  });

  it.each(fx.custom)("custom ticks on $scale over $view", (c) => {
    const got = customTicksIn(c.custom, c.view[0], c.view[1], (v) => drawableOn(v, c.scale, c.fmt));
    expect(got).toEqual({ at: c.at, labels: c.labels });
  });

  it.each(fx.cross)("crossing at $cross over $view", (c) => {
    expect(crossPosition(c.cross, c.view[0], c.view[1], c.drawable)).toBe(c.position);
  });
});

type Splits = (u: uPlot, i: number, min: number, max: number, incr: number, space: number) => number[];
type Values = (u: uPlot, splits: number[], i: number, space: number, incr: number) => (string | null)[];
type Range = (u: uPlot, min: number | null, max: number | null, key: string) => [number, number];

/** A drawing context that records every line the crossing strokes. */
function recordingCtx() {
  const lines: [number, number, number, number][] = [];
  let from: [number, number] = [0, 0];
  const texts: { text: string; x: number; y: number }[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, stroke() {}, setLineDash() {},
    moveTo(x: number, y: number) { from = [x, y]; },
    lineTo(x: number, y: number) { lines.push([from[0], from[1], x, y]); },
    fillText(text: string, x: number, y: number) { texts.push({ text, x, y }); },
  };
  return { ctx, lines, texts };
}

/** uPlot's valToPos for a plain linear / log scale over `[min, max]`. */
function pos(scale: string, min: number, max: number, from: number, size: number) {
  const t = (v: number) => (scale === "log" ? (v > 0 ? Math.log10(v) : NaN) : v);
  return (v: number) => from + ((t(v) - t(min)) / (t(max) - t(min))) * size;
}

describe("axis_scales.json: the canvas draws what the export drew", () => {
  it.each(fx.export)("$name", (c) => {
    const xFmt = c.x_fmt ?? { mode: "auto", digits: 2 };
    const yFmt = c.y_fmt ?? { mode: "auto", digits: 2 };
    const idx = c.axis === "x" ? 0 : 1;
    const key = c.axis;
    const typed = [!!(c.axis === "x" ? c.view : c.x_view), !!(c.axis === "y" ? c.view : c.y_view), false];
    const ctx: AxisExtrasContext = {
      scales: { x: c.axis === "x" && c.view ? { range: c.view } : {}, y: c.axis === "y" && c.view ? { range: c.view } : {} },
      payload: { data: [c.x, c.y], series: [{ axis: 0 }] },
      typed,
      steps: [null, null, null],
      scan: false,
      y2Own: false,
    };
    const plain: Values = (_u, splits) => splits.map((v) => String(v));
    const axes: uPlot.Axis[] = [{ scale: "x", values: plain, side: 2 }, { scale: "y", values: plain, side: 3 }];
    const plugin = applyAxisExtras(axes, [xFmt, yFmt], [(c.x_scale ?? "linear") as "linear", (c.y_scale ?? "linear") as "linear"], "#000", ctx);
    expect(plugin).not.toBeNull();
    const u = {} as uPlot;
    // The range the screen draws: the probability axis' own auto range, or the typed view.
    const range = ctx.scales[key].range;
    const lim = typeof range === "function" ? (range as Range)(u, null, null, key) : (range as [number, number]);
    close(lim, c.lim);
    const fmt = c.axis === "x" ? xFmt : yFmt;
    if (fmt.cross === undefined) {
      const splits = (axes[idx].splits as Splits)(u, idx, lim[0], lim[1], 1, 30);
      close(splits, c.ticks);
      const labels = (axes[idx].values as Values)(u, splits, idx, 30, 1);
      // An unlabelled custom tick is the axis' own number on either side,
      // and each engine formats its own numbers ("auto" is not shared).
      const own = fmt.custom ? c.labels.map((l, i) => (fmt.custom!.labels?.[fmt.custom!.at.indexOf(c.ticks[i])]?.trim() ? l : null)) : c.labels;
      labels.forEach((l, i) => own[i] !== null && expect(l).toBe(own[i]));
      return;
    }
    // The crossing: the axis line sits where the export put it.
    const other = c.axis === "x" ? "y" : "x";
    const ov = (other === "x" ? c.x_view : c.y_view) ?? [Math.min(...c[other]), Math.max(...c[other])];
    const bbox = { left: 100, top: 20, width: 400, height: 300 };
    const oScale = (other === "x" ? c.x_scale : c.y_scale) ?? "linear";
    const toPos = {
      x: other === "x" ? pos(oScale, ov[0], ov[1], bbox.left, bbox.width) : pos("linear", lim[0], lim[1], bbox.left, bbox.width),
      y: other === "y" ? pos(oScale, ov[0], ov[1], bbox.top + bbox.height, -bbox.height) : pos("linear", lim[0], lim[1], bbox.top + bbox.height, -bbox.height),
    };
    const rec = recordingCtx();
    const drawn = {
      ctx: rec.ctx, bbox, axes: axes.map((a) => ({ ...a, _splits: c.ticks })),
      scales: { [other]: { min: ov[0], max: ov[1] } },
      valToPos: (v: number, k: string) => toPos[k as "x" | "y"](v),
    } as unknown as uPlot;
    // uPlot hands the formatter its splits before it lays the axis out.
    (axes[idx].values as Values)(drawn, c.ticks, idx, 30, 1);
    (plugin!.hooks.draw as (u: uPlot) => void)(drawn);
    const [x0, y0, x1, y1] = rec.lines[0];
    const frac = c.axis === "x" ? (bbox.top + bbox.height - y0) / bbox.height : (x0 - bbox.left) / bbox.width;
    expect(c.axis === "x" ? y0 === y1 : x0 === x1).toBe(true);
    expect(frac).toBeCloseTo(c.crossFraction!, 9);
    // Every tick is labelled at the crossing, on the axis' own side.
    expect(rec.texts.map((t) => t.text)).toEqual(c.ticks.map(String));
    for (const t of rec.texts) expect(c.axis === "x" ? t.y > y0 : t.x < x0).toBe(true);
  });
});
