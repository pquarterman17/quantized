// G24: the canvas paints each row-states point in its own colour and glyph, and a
// stateless row in the series stroke; a non-flat spec (a colour scale) is still
// skipped when its z is missing, exactly as before.

import { describe, expect, it } from "vitest";

import type { ColorScatterSpec } from "./colorscatter";
import { drawColorScatter } from "./uplotScatterDraw";

function paint(spec: ColorScatterSpec, stroke: unknown = "#336699") {
  const dots: { kind: string; fill: string }[] = [];
  let fillStyle = "";
  let kind = "";
  const ctx = {
    save() {}, restore() {}, beginPath() { kind = ""; }, rect() {}, clip() {}, closePath() {}, stroke() {},
    moveTo() { kind ||= "poly"; }, lineTo() { kind ||= "poly"; },
    arc() { kind = "circle"; },
    fill() { dots.push({ kind, fill: fillStyle }); },
    set fillStyle(v: string) { fillStyle = v; },
    set strokeStyle(_v: string) {},
  };
  const u = {
    ctx, bbox: { left: 0, top: 0, width: 200, height: 100 },
    valToPos: (v: number, s: string) => (s === "x" ? v : 100 - v),
    data: [[0, 1, 2, 3], [10, 20, 30, 40]],
    series: [{}, { stroke }],
  };
  // @ts-expect-error -- a minimal stub stands in for a uPlot instance
  drawColorScatter(u, new Map([[1, spec]]));
  return dots;
}

const flat = (over: Partial<ColorScatterSpec>): ColorScatterSpec => ({ channel: 1, z: [], colormap: "viridis", lo: 0, hi: 1, flat: true, ...over });

describe("row-states painting", () => {
  it("each row takes its own fill; a stateless row takes the series stroke", () => {
    const dots = paint(flat({ fills: ["#0b6e4f", null, "#c3423f", null] }));
    expect(dots.map((d) => d.fill)).toEqual(["#0b6e4f", "#336699", "#c3423f", "#336699"]);
  });

  it("each row takes its own glyph (circle vs a polygon), falling back to the series glyph", () => {
    const dots = paint(flat({ fills: ["#0b6e4f", "#0b6e4f", "#0b6e4f", "#0b6e4f"], shapes: ["square", null, "triangle", null] }));
    expect(dots.map((d) => d.kind)).toEqual(["poly", "circle", "poly", "circle"]);
    expect(paint(flat({ fills: ["#0b6e4f", null, null, null], shapes: [null, null, null, null], shape: "square" })).map((d) => d.kind)).toEqual(["poly", "poly", "poly", "poly"]);
  });

  it("a colour-scale spec with no value for a row still draws nothing there (unchanged)", () => {
    const dots = paint({ channel: 1, z: [0, 1, null, 1], colormap: "viridis", lo: 0, hi: 1 });
    expect(dots).toHaveLength(3);
  });
});
