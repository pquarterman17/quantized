// The `clock` tick mode (lib/clockTicks.ts). The label and step tables are
// the same as tests/test_calc_clock_ticks.py's, so screen and export agree.

import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { clockLabel, clockStep, clockXAxis } from "./clockTicks";

describe("clockLabel", () => {
  it.each([
    [45000, 3600, "12:30"],
    [45001, 1, "12:30:01"],
    [45001.25, 0.25, "12:30:01.25"],
    [45001.5, 0.5, "12:30:01.5"],
    [86400 + 1800, 1800, "00:30"], // unwrapped past midnight: the clock wraps
    [86400, 86400, "1d 00:00"], // a day apart: the day offset, never a date
    [3599.9999, 1, "01:00:00"], // rounds into the next minute, never ":60"
    [90, 90, "00:01:30"],
    [-60, 60, "23:59"],
    [12, 0, "00:00:12"],
  ])("labels %s s at a %s s step as %s", (x, step, label) => {
    expect(clockLabel(x, step)).toBe(label);
  });

  it("is blank for a non-finite value and never shows 1970", () => {
    expect(clockLabel(Number.NaN, 60)).toBe("");
    for (const step of [1, 60, 3600, 86400, 864000]) expect(clockLabel(5 * 86400, step)).not.toMatch(/19\d\d/);
  });
});

describe("clockStep", () => {
  it.each([
    [0.3, 0.5], [7, 10], [11, 15], [4000, 7200], [50000, 86400], [90000, 172800],
    [3 * 86400, 5 * 86400], [0, 1], [Number.NaN, 1],
  ])("rounds %s s up to %s s", (min, step) => {
    expect(clockStep(min)).toBe(step);
  });
});

describe("clockXAxis", () => {
  it("ticks at whole clock increments, labelled as times of day", () => {
    const axis = clockXAxis({ mode: "clock", digits: 2 }, "linear", null, 11);
    if (!axis?.splits) throw new Error("a linear clock axis has its own splits");
    const u = {} as uPlot;
    // 8 h across 800 px: 100 px per hour, so at least ~65 px apart -> 1 h.
    const splits = (axis.splits as (u: uPlot, i: number, min: number, max: number, incr: number, space: number) => number[])(
      u, 0, 82_800, 82_800 + 8 * 3600, 3600, 100,
    );
    expect(splits[0]).toBe(82_800);
    expect(splits[1] - splits[0]).toBe(3600);
    expect(axis.values(u, splits).slice(0, 3)).toEqual(["23:00", "00:00", "01:00"]);
  });

  it("leaves a typed increment's ticks alone, and a non-linear or non-clock axis", () => {
    const typed = clockXAxis({ mode: "clock", digits: 2 }, "linear", 600, 11);
    expect(typed?.splits).toBeUndefined();
    expect(typed?.values({} as uPlot, [82_800, 83_400])).toEqual(["23:00", "23:10"]);
    expect(clockXAxis({ mode: "clock", digits: 2 }, "log", null, 11)).toBeNull();
    expect(clockXAxis({ mode: "auto", digits: 2 }, "linear", null, 11)).toBeNull();
  });
});
