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
