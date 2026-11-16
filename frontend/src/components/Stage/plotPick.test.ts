// UX-A: what a Pointer click selects, and the halo drawn for it.

import { afterEach, describe, expect, it } from "vitest";

import { haloGeometry, pickAt } from "./plotPick";
import { makeFakePlot, OVER } from "../../test/plotSelectionFixture";

afterEach(() => {
  document.body.innerHTML = "";
});

// Client point of data (x, y): plot-area px + the over's offset.
const at = (x: number, y: number): [number, number] => [OVER.left + x * 10, OVER.top + (10 - y) * 10];

describe("pickAt", () => {
  it("selects the curve under the click, by dataset channel", () => {
    const { u, over } = makeFakePlot();
    // plotted: display series 0 -> channel 3, display series 1 -> channel 5.
    expect(pickAt(u, over, ...at(2, 2), [3, 5], false)).toEqual({ kind: "series", channel: 3 });
    expect(pickAt(u, over, ...at(2, 8), [3, 5], false)).toEqual({ kind: "series", channel: 5 });
  });

  it("clears on empty plot area, far from every curve", () => {
    const { u, over } = makeFakePlot();
    expect(pickAt(u, over, ...at(1, 5), [0, 1], false)).toBeNull();
  });

  it("leaves a click on an annotation / shape / reference line to its plugin", () => {
    const { u, over } = makeFakePlot();
    over.style.cursor = "move";
    expect(pickAt(u, over, ...at(2, 2), [0, 1], false)).toBeUndefined();
  });

  it("does not pick a hidden curve", () => {
    const { u, over } = makeFakePlot();
    (u.series[1] as { show: boolean }).show = false;
    expect(pickAt(u, over, ...at(2, 2), [0, 1], false)).toBeNull();
  });

  it("selects the axis whose band holds the click", () => {
    const { u, axisX } = makeFakePlot();
    expect(pickAt(u, axisX, 100, 140, [0, 1], false)).toEqual({ kind: "axis", axis: "x" });
    expect(pickAt(u, axisX, 20, 60, [0, 1], false)).toEqual({ kind: "axis", axis: "y" });
    expect(pickAt(u, axisX, 180, 60, [0, 1], true)).toEqual({ kind: "axis", axis: "y2" });
    // No Y2 drawn: the right gutter selects nothing.
    expect(pickAt(u, axisX, 180, 60, [0, 1], false)).toBeUndefined();
  });

  it("selects the legend", () => {
    const { u, legend } = makeFakePlot();
    expect(pickAt(u, legend, 130, 35, [0, 1], false)).toEqual({ kind: "legend" });
  });

  it("ignores a click elsewhere in the stage (toolbar, title)", () => {
    const { u, stage } = makeFakePlot();
    expect(pickAt(u, stage, 5, 5, [0, 1], false)).toBeUndefined();
  });
});

describe("haloGeometry", () => {
  it("strokes the selected curve's points in stage coordinates, wider than the line", () => {
    const { u, stage } = makeFakePlot();
    const g = haloGeometry(u, stage, { kind: "series", channel: 7 }, [4, 7]);
    // Display series 1 (channel 7) falls: (0,10) -> (50,20) ... (10,0) -> (150,120).
    expect(g.d.startsWith("M50.0,20.0L60.0,30.0")).toBe(true);
    expect(g.d.endsWith("L150.0,120.0")).toBe(true);
    expect(g.width).toBe(7.5);
    expect(g.box).toBeNull();
  });

  it("draws dots for a markers-only curve", () => {
    const { u, stage } = makeFakePlot([0, 1.5]);
    const g = haloGeometry(u, stage, { kind: "series", channel: 0 }, [0, 1]);
    expect(g.d).toContain("M50.0,120.0h0M60.0,110.0h0");
    expect(g.d).not.toContain("L");
  });

  it("draws nothing for a curve that is not plotted", () => {
    const { u, stage } = makeFakePlot();
    expect(haloGeometry(u, stage, { kind: "series", channel: 9 }, [0, 1])).toEqual({ d: "", width: 0, box: null });
  });

  it("outlines the axis band and the legend box", () => {
    const { u, stage } = makeFakePlot();
    expect(haloGeometry(u, stage, { kind: "axis", axis: "x" }, [0, 1]).box).toEqual({ x: 50, y: 120, w: 100, h: 40 });
    expect(haloGeometry(u, stage, { kind: "axis", axis: "y" }, [0, 1]).box).toEqual({ x: 0, y: 20, w: 50, h: 100 });
    expect(haloGeometry(u, stage, { kind: "legend" }, [0, 1]).box).toEqual({ x: 120, y: 30, w: 25, h: 15 });
  });
});
