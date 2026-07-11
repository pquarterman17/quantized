// lib/previewmap — hit-testing + pixel↔data/figure mapping (#13/#14).

import { describe, expect, it } from "vitest";

import {
  groupForElement,
  hitAt,
  pxToData,
  pxToFigureFraction,
  type AxesInfo,
} from "./previewmap";

const AXES: AxesInfo = {
  x0: 100,
  y0: 50,
  x1: 500,
  y1: 350,
  xlim: [0, 10],
  ylim: [1, 100],
  xlog: false,
  ylog: false,
};

describe("hitAt", () => {
  const els = [
    { id: "series:0", x0: 0, y0: 0, x1: 600, y1: 400 }, // big
    { id: "legend", x0: 400, y0: 60, x1: 480, y1: 120 }, // small, inside big
  ];

  it("returns the smallest hit box (legend beats the series that crosses it)", () => {
    expect(hitAt(els, 440, 90)?.id).toBe("legend");
    expect(hitAt(els, 200, 200)?.id).toBe("series:0");
    expect(hitAt(els, 700, 90)).toBeNull();
  });
});

describe("pxToData", () => {
  it("maps linear axes with the y flip", () => {
    expect(pxToData(AXES, 100, 350)).toEqual({ x: 0, y: 1 }); // bottom-left
    expect(pxToData(AXES, 500, 50)).toEqual({ x: 10, y: 100 }); // top-right
    const mid = pxToData(AXES, 300, 200);
    expect(mid.x).toBeCloseTo(5);
    expect(mid.y).toBeCloseTo(50.5);
  });

  it("maps log axes in log space", () => {
    const la = { ...AXES, ylog: true };
    expect(pxToData(la, 100, 200).y).toBeCloseTo(10); // halfway between 1 and 100
  });

  // MAIN #12: a reciprocal-scaled preview axis must invert differently from
  // log — the "xlog"/"ylog" booleans alone can't express it, hence "xscale"/
  // "yscale" as the scale-name source of truth.
  it("maps a reciprocal axis in 1/x space (round-trips the endpoints exactly)", () => {
    const ra: AxesInfo = { ...AXES, xlim: [100, 300], xscale: "reciprocal" };
    expect(pxToData(ra, ra.x0, 200).x).toBeCloseTo(100, 6); // left edge = xlim[0]
    expect(pxToData(ra, ra.x1, 200).x).toBeCloseTo(300, 6); // right edge = xlim[1]
    // Midpoint in PIXEL space is NOT the midpoint in DATA space for a
    // reciprocal axis (it's the midpoint in 1/x space instead).
    const midPx = (ra.x0 + ra.x1) / 2;
    const midX = pxToData(ra, midPx, 200).x;
    expect(midX).not.toBeCloseTo((100 + 300) / 2, 0);
    expect(midX).toBeCloseTo(1 / ((1 / 100 + 1 / 300) / 2), 6); // harmonic mean
  });

  it("falls back to xlog/ylog when xscale/yscale is absent (older backend response)", () => {
    const legacy: AxesInfo = { ...AXES, ylim: [1, 100], ylog: true };
    expect(pxToData(legacy, 100, 200).y).toBeCloseTo(10);
  });

  it("xscale, when present, wins over a stale/mismatched xlog", () => {
    const mixed: AxesInfo = { ...AXES, xlim: [100, 300], xscale: "reciprocal", xlog: true };
    expect(pxToData(mixed, mixed.x0, 200).x).toBeCloseTo(100, 6);
  });
});

describe("pxToFigureFraction", () => {
  it("clamps to [0,1] and flips y to bottom-left origin", () => {
    expect(pxToFigureFraction(600, 400, 300, 100)).toEqual([0.5, 0.75]);
    expect(pxToFigureFraction(600, 400, -10, 500)).toEqual([0, 0]);
  });
});

describe("groupForElement", () => {
  it("routes elements to their #11 panel groups", () => {
    expect(groupForElement("legend")).toBe("Legend");
    expect(groupForElement("ann:2")).toBe("Annotations");
    expect(groupForElement("title")).toBe("Text & fonts");
    expect(groupForElement("series:0")).toBeNull();
  });
});
