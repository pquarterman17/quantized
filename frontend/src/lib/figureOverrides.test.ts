// lib/figureOverrides — the #11 config compactor + MAIN #18's legend-corner
// export mapping.

import { describe, expect, it } from "vitest";

import { compactOverrides, legendPosToLoc } from "./figureOverrides";

describe("compactOverrides", () => {
  it("returns null when nothing is set (presets rule untouched figures)", () => {
    expect(compactOverrides({})).toBeNull();
    expect(compactOverrides({ legend: {}, ticks: {} })).toBeNull();
    expect(compactOverrides({ x_lim: [null, null], annotations: [] })).toBeNull();
    expect(compactOverrides({ x_breaks: [] })).toBeNull();
  });

  it("keeps set leaves and drops undefined siblings", () => {
    expect(
      compactOverrides({
        font_size: 9,
        legend: { loc: "outside right", show: undefined },
        ticks: { dir: undefined },
        y_lim: [null, 20],
      }),
    ).toEqual({
      font_size: 9,
      legend: { loc: "outside right" },
      y_lim: [null, 20],
    });
  });

  it("keeps non-empty annotations", () => {
    expect(
      compactOverrides({ annotations: [{ x: 1, y: 2, text: "peak" }] }),
    ).toEqual({ annotations: [{ x: 1, y: 2, text: "peak" }] });
  });

  it("keeps non-empty x_breaks (gap #21 export-side axis breaks)", () => {
    expect(compactOverrides({ x_breaks: [[10, 60]] })).toEqual({ x_breaks: [[10, 60]] });
  });

  it("keeps a per-annotation size override alongside x/y/text", () => {
    expect(
      compactOverrides({ annotations: [{ x: 1, y: 2, text: "peak", size: 24 }] }),
    ).toEqual({ annotations: [{ x: 1, y: 2, text: "peak", size: 24 }] });
  });
});

describe("legendPosToLoc (MAIN #18 — export-parity corner mapping)", () => {
  it("maps every corner preset to its matplotlib loc string", () => {
    expect(legendPosToLoc("ne")).toBe("upper right");
    expect(legendPosToLoc("nw")).toBe("upper left");
    expect(legendPosToLoc("se")).toBe("lower right");
    expect(legendPosToLoc("sw")).toBe("lower left");
  });
});
