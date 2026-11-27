// The curve-measurement gadget settings turned into requests, and the markers
// drawn from a measurement. Reference numbers are computed by hand (numpy for the
// mid-range level of the sample below: (min + max) / 2 = (-2 + 5) / 2 = 1.5).

import { describe, expect, it } from "vitest";

import type { LevelCrossingResult, StepTimeResult } from "./api/curveMeasure";
import { measureMarkers, sourceRowSpan, type GadgetMeasure } from "./gadgetMeasure";
import { DEFAULT_GADGET_MEASURE_OPTIONS as D, GADGET_STEP_BODY, levelBodyFor, stepBodyFor } from "./gadgetMeasureOptions";

const X = [0, 1, 2, 3, 4];
const Y = [-2, 0, 3, 5, 1];

describe("rise-time settings", () => {
  it("the default sends exactly today's request", () => {
    const r = stepBodyFor(D, X, Y);
    expect(r).toEqual({ ok: true, body: { x: X, y: Y, ...GADGET_STEP_BODY } });
  });

  it("20 / 80 and a custom pair become fractions", () => {
    expect(stepBodyFor({ ...D, stepPreset: "20-80" }, X, Y)).toMatchObject({ ok: true, body: { low_fraction: 0.2, high_fraction: 0.8, edge: "auto" } });
    expect(stepBodyFor({ ...D, stepPreset: "custom", lowPct: "5", highPct: "95" }, X, Y)).toMatchObject({ ok: true, body: { low_fraction: 0.05, high_fraction: 0.95 } });
  });

  it("refuses a bad pair with the reason", () => {
    for (const [lo, hi] of [["50", "40"], ["0", "90"], ["10", "100"], ["", "90"], ["a", "90"]]) {
      expect(stepBodyFor({ ...D, stepPreset: "custom", lowPct: lo!, highPct: hi! }, X, Y)).toMatchObject({ ok: false, error: expect.stringMatching(/percentages/) });
    }
  });

  it("reference levels are sent only when given, each on its own", () => {
    expect(stepBodyFor({ ...D, lowLevel: "0.5" }, X, Y)).toMatchObject({ ok: true, body: { low_level: 0.5 } });
    const both = stepBodyFor({ ...D, lowLevel: "0.5", highLevel: "9" }, X, Y);
    expect(both.ok && both.body).toMatchObject({ low_level: 0.5, high_level: 9 });
    const none = stepBodyFor(D, X, Y);
    expect(none.ok && "low_level" in none.body).toBe(false);
    expect(stepBodyFor({ ...D, highLevel: "x" }, X, Y)).toMatchObject({ ok: false, error: expect.stringMatching(/high level/) });
  });

  it("edge is passed through", () => {
    expect(stepBodyFor({ ...D, edge: "fall" }, X, Y)).toMatchObject({ ok: true, body: { edge: "fall", low_fraction: 0.1, high_fraction: 0.9 } });
  });
});

describe("level-crossing settings", () => {
  it("an empty level is the middle of the region's Y range", () => {
    const r = levelBodyFor(D, X, Y);
    expect(r).toMatchObject({ ok: true, auto: true, body: { level: 1.5, hysteresis: 0, direction: "both" } });
  });

  it("a given level, dead band and direction are sent as typed", () => {
    const r = levelBodyFor({ ...D, level: "2.5", hysteresis: "0.2", direction: "rising" }, X, Y);
    expect(r).toMatchObject({ ok: true, auto: false, body: { level: 2.5, hysteresis: 0.2, direction: "rising" } });
  });

  it("sweep order is opt-in: absent from the default request, sent once ticked", () => {
    const off = levelBodyFor(D, X, Y);
    expect(off.ok && "in_order" in off.body).toBe(false);
    expect(levelBodyFor({ ...D, inOrder: true }, X, Y)).toMatchObject({ ok: true, body: { in_order: true } });
  });

  it("refuses text and a negative dead band", () => {
    expect(levelBodyFor({ ...D, level: "abc" }, X, Y)).toMatchObject({ ok: false });
    expect(levelBodyFor({ ...D, hysteresis: "-1" }, X, Y)).toMatchObject({ ok: false });
  });
});

describe("markers", () => {
  const stamp = { units: { x: "s", y: "V", yB: "V" }, source: { id: "a", computedOn: "f", roi: [0, 4] as [number, number], a: { yKey: 2, xKey: null }, b: null, bSheet: null, rows: null } }; // curve A is channel 2
  const level: LevelCrossingResult = { level: 1.5, hysteresis: 0, crossings: [{ x: 1.25, direction: "rising" }, { x: 3.75, direction: "falling" }], n_points: 5, dropped: 0, merged_duplicates: 0 };
  const step = { edge: "rise", time: 1.2, x_low: 2.4, x_high: 3.6, low_level: 2, high_level: 8 } as StepTimeResult;

  it("a ring at each crossing on the level, and a guide at the level", () => {
    const m: GadgetMeasure = { mode: "levelcrossing", r: level, auto: false, ...stamp };
    expect(measureMarkers(m)).toEqual({ points: [{ x: 1.25, y: 1.5, yKey: 2 }, { x: 3.75, y: 1.5, yKey: 2 }], levels: [{ y: 1.5, yKey: 2 }] });
  });

  it("rise time marks both reference crossings and both levels", () => {
    expect(measureMarkers({ mode: "risetime", r: step, ...stamp })).toEqual({
      points: [{ x: 2.4, y: 2, yKey: 2 }, { x: 3.6, y: 8, yKey: 2 }],
      levels: [{ y: 2, yKey: 2 }, { y: 8, yKey: 2 }],
    });
  });

  it("intersections are rings at (x, y); interpolation skips values outside the curve", () => {
    const inter: GadgetMeasure = { mode: "intersect", bKey: 1, ...stamp, r: { intersections: [{ x: 2, y: 3, kind: "cross", direction: null, x_end: 2 }] } as never };
    expect(measureMarkers(inter).points).toEqual([{ x: 2, y: 3, yKey: 2 }]);
    const ip: GadgetMeasure = { mode: "interpolate", at: [1, 9], rows: [{ yKey: 0, y: [1.5, null] }, { yKey: 3, y: [null, 40] }] };
    expect(measureMarkers(ip)).toEqual({ points: [{ x: 1, y: 1.5, yKey: 0 }, { x: 9, y: 40, yKey: 3 }], levels: [] }); // each ring on its own row's curve
    expect(measureMarkers(null)).toEqual({ points: [], levels: [] });
  });
});

describe("source rows", () => {
  it("are the worksheet rows, 1-based, first to last", () => {
    expect(sourceRowSpan([7, 3, 5])).toEqual({ first: 4, last: 8, n: 3 });
    expect(sourceRowSpan([])).toBeNull();
  });
});
