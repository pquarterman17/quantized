// UX audit 8 #8: the screen half of the shared fixture
// tests/fixtures/wire/tick_multiplier.json -- the export half is
// tests/test_tick_multiplier.py. Both draw the fixture's auto labels and
// ×10ⁿ factor for the same ticks.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import { autoFactorTopPad, autoMultiplierAllowed, autoTickExponent, drawAutoFactors } from "./autoTickValues";
import type { AxisFormat } from "./types";
import { tickFormatter } from "./uplotOpts";

interface Case { name: string; ticks: number[]; labels: string[]; factor: string | null }
const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "../../../tests/fixtures/wire/tick_multiplier.json"), "utf8")) as { cases: Case[] };

/** A stand-in uPlot with one X and one Y axis and a recording canvas. */
function fakePlot(font = "12px mono") {
  const texts: { text: string; align: string }[] = [];
  const ctx = {
    save: vi.fn(), restore: vi.fn(), font: "", fillStyle: "", textAlign: "", textBaseline: "",
    fillText(text: string) { texts.push({ text, align: this.textAlign }); },
  };
  const u = {
    ctx,
    bbox: { left: 60, top: 20, width: 400, height: 300 },
    axes: [{ side: 2, font, stroke: "#111" }, { side: 3, font, stroke: () => "#222" }],
  } as unknown as uPlot;
  return { u, texts };
}

const labelsOn = (u: uPlot | null, ticks: number[], idx = 1, fmt?: AxisFormat) =>
  tickFormatter(fmt, "linear")(u as never, ticks, idx, 30, 0);

describe("auto ticks: the shared ×10ⁿ fixture", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const { u, texts } = fakePlot();
      expect(labelsOn(u, c.ticks)).toEqual(c.labels);
      drawAutoFactors(u);
      expect(texts.map((t) => t.text)).toEqual(c.factor ? [c.factor] : []);
    });
  }
});

describe("auto ticks: the ×10ⁿ factor", () => {
  it("is the order of magnitude of the largest |tick|, outside 1e-2..1e4", () => {
    expect(autoTickExponent([0, 0.0095])).toBe(-3);
    expect(autoTickExponent([0, 0.01])).toBeNull();
    expect(autoTickExponent([-9999, 0])).toBeNull();
    expect(autoTickExponent([-1e4, 0])).toBe(4);
    expect(autoTickExponent([2e-7, null, NaN])).toBe(-7);
    expect(autoTickExponent([0, 0])).toBeNull();
  });

  it("follows the axis: a zoom that drops the factor stops drawing it", () => {
    const { u, texts } = fakePlot();
    labelsOn(u, [0, 0.001, 0.002]);
    labelsOn(u, [0, 0.01, 0.02]);
    drawAutoFactors(u);
    expect(texts).toEqual([]);
  });

  it("X draws at the right end, Y at the top", () => {
    const { u, texts } = fakePlot();
    labelsOn(u, [0, 2e4, 4e4], 0);
    labelsOn(u, [0, 0.001, 0.002], 1);
    drawAutoFactors(u);
    expect(texts).toEqual([{ text: "×10⁴", align: "right" }, { text: "×10⁻³", align: "left" }]);
  });

  it("reserves a top band while the Y scale spans a ×10ⁿ range", () => {
    const { u } = fakePlot();
    const scales = { y: { min: 0, max: 1 } };
    Object.assign(u, { scales });
    const top = autoFactorTopPad(null, [[1, "y"]]) as (u: uPlot, s: number, sides: boolean[], c: number) => number;
    const sides = [false, false, true, true];
    expect(top(u, 0, sides, 0)).toBe(17); // uPlot's own top pad beside a y axis
    scales.y.max = 0.0018;
    expect(top(u, 0, sides, 1)).toBe(Math.ceil(12 * 1.25 + 8));
    expect(autoFactorTopPad(5, [])).toBe(5);
  });

  it("reserves the band for whichever axis is vertical, and for a drawn factor whatever the range", () => {
    const { u } = fakePlot();
    const scales = { x: { min: -7e4, max: 7e4 }, y: { min: 0, max: 0.0105 } };
    Object.assign(u, { scales });
    const top = autoFactorTopPad(null, [[0, "x"], [1, "y"]]) as (u: uPlot, s: number, sides: boolean[], c: number) => number;
    const sides = [false, false, true, true];
    expect(top(u, 0, sides, 0)).toBe(17); // X is horizontal; Y's range takes no factor
    labelsOn(u, [0, 0.003, 0.006, 0.009], 1); // a typed step: the drawn ticks take ×10⁻³
    expect(top(u, 0, sides, 1)).toBe(23);
    // Exchange X-Y: X on the left is the vertical axis now.
    const { u: ex } = fakePlot();
    Object.assign(ex, { scales });
    (ex.axes[0] as { side: number }).side = 3;
    (ex.axes[1] as { side: number }).side = 2;
    expect(top(ex, 0, sides, 0)).toBe(23);
  });

  it("an axis uPlot hides (its scale has no data) drops its factor", () => {
    const { u, texts } = fakePlot();
    labelsOn(u, [0, 0.001, 0.002], 1);
    (u.axes[1] as { _show?: boolean })._show = false;
    drawAutoFactors(u);
    expect(texts).toEqual([]);
  });

  it("is for auto mode only: an explicit format, affix, divide-by, custom ticks, breaks or a crossing keep their own labels", () => {
    const off: AxisFormat[] = [
      { mode: "fixed", digits: 2 },
      { mode: "auto", digits: 2, prefix: "$" },
      { mode: "auto", digits: 2, suffix: " K" },
      { mode: "auto", digits: 2, divide: 1000 },
      { mode: "auto", digits: 2, custom: { at: [0, 0.001] } },
      { mode: "auto", digits: 2, breaks: [[1, 2]] },
      { mode: "auto", digits: 2, cross: 0 },
    ];
    for (const fmt of off) expect(autoMultiplierAllowed(fmt)).toBe(false);
    expect(autoMultiplierAllowed({ mode: "auto", digits: 2, divide: 1, minor: 4 })).toBe(true);
    const { u, texts } = fakePlot();
    expect(labelsOn(u, [0, 0.001], 1, { mode: "auto", digits: 2, suffix: " K" })).toEqual(["0.000", "0.001"]);
    drawAutoFactors(u);
    expect(texts).toEqual([]);
  });

  it("a Y3+ axis (factor off) keeps plain labels", () => {
    const { u, texts } = fakePlot();
    expect(tickFormatter(undefined, "linear", false)(u, [0, 0.001], 1, 30, 0)).toEqual(["0.000", "0.001"]);
    drawAutoFactors(u);
    expect(texts).toEqual([]);
  });

  it("log axes are unaffected", () => {
    expect(tickFormatter(undefined, "log")(null as never, [1e-4, 1e-3, 1e-2], 1, 30, 0)).toEqual(["10⁻⁴", "10⁻³", "10⁻²"]);
  });
});
