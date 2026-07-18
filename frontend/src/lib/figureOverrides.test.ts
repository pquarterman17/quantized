// lib/figureOverrides — the #11 config compactor + MAIN #18's legend-corner
// export mapping.

import { describe, expect, it } from "vitest";

import { compactOverrides, gateY2Overrides, legendPosToLoc } from "./figureOverrides";

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

describe("gateY2Overrides (GUI_INTERACTION #12 slice 4a)", () => {
  it("strips y2_lim when nothing is plotted on y2, keeping every other field", () => {
    const gated = gateY2Overrides(
      { grid: true, y2_lim: [-5, 5] },
      { y2Plotted: false, minorTicks: false },
    );
    expect(gated).toEqual({ grid: true });
  });

  it("keeps y2_lim when a channel is plotted on y2", () => {
    const gated = gateY2Overrides(
      { grid: true, y2_lim: [-5, 5] },
      { y2Plotted: true, minorTicks: false },
    );
    expect(gated).toEqual({ grid: true, y2_lim: [-5, 5] });
  });

  it("turns ticks.minor on when minorTicks is true, even with no prior ticks override", () => {
    const gated = gateY2Overrides({ grid: true }, { y2Plotted: false, minorTicks: true });
    expect(gated).toEqual({ grid: true, ticks: { minor: true } });
  });

  it("leaves other ticks fields (dir/len) untouched while forcing minor on", () => {
    const gated = gateY2Overrides(
      { ticks: { dir: "out", len: 5 } },
      { y2Plotted: false, minorTicks: true },
    );
    expect(gated).toEqual({ ticks: { dir: "out", len: 5, minor: true } });
  });

  it("passes an undefined overrides object through untouched when minorTicks is false", () => {
    expect(gateY2Overrides(undefined, { y2Plotted: false, minorTicks: false })).toBeUndefined();
  });

  it("builds a fresh ticks override from undefined overrides when minorTicks is true", () => {
    const gated = gateY2Overrides(undefined, { y2Plotted: false, minorTicks: true });
    expect(gated).toEqual({ ticks: { minor: true } });
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
