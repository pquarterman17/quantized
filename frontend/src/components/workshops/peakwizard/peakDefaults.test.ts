import { describe, expect, it } from "vitest";

import {
  decays,
  freeParamWarning,
  heavyModel,
  stoppedAtTimeLimit,
  suggestedBaseline,
  weakerThanStrongest,
} from "./peakDefaults";

const xs = Array.from({ length: 500 }, (_, i) => i);
// An XRD-like trace: a decaying background with sharp peaks on it.
const xrd = xs.map((i) => 15 + 70 * Math.exp(-i / 120) + (i % 60 === 30 ? 400 : 0));

describe("decays", () => {
  it("sees a decaying background through its peaks", () => {
    expect(decays(xrd)).toBe(true);
  });
  it("rejects a flat, a rising or a too-short trace", () => {
    expect(decays(xs.map((i) => 20 + (i % 60 === 30 ? 400 : 0)))).toBe(false);
    expect(decays(xs.map((i) => 50 + i))).toBe(false);
    expect(decays(xrd.slice(0, 10))).toBe(false);
  });
  it("rejects a trace that dips and recovers, or ends at or below zero", () => {
    expect(decays(xs.map((i) => (i < 250 ? 100 - i / 5 : 50 + (i - 250))))).toBe(false);
    expect(decays(xs.map((i) => 100 - i / 2))).toBe(false); // last chunk's median is negative
  });
});

describe("suggestedBaseline", () => {
  it("SNIP on a log-Y plot or a decaying trace, none otherwise", () => {
    expect(suggestedBaseline(xs.map(() => 5), true)).toBe("snip");
    expect(suggestedBaseline(xrd, false)).toBe("snip");
    expect(suggestedBaseline(xs.map(() => 5), false)).toBeNull();
  });
});

describe("heavyModel / freeParamWarning", () => {
  it("warns above 40 free parameters or one per 50 points", () => {
    expect(heavyModel(40, 6474)).toBe(false);
    expect(heavyModel(41, 6474)).toBe(true);
    expect(heavyModel(9, 400)).toBe(true); // 400 / 50 = 8
    expect(freeParamWarning(62, 6474)).toMatch(/^62 free parameters for 6474 points: .*10 s time limit/);
    expect(freeParamWarning(24, 6474)).toBeNull();
  });
});

describe("stoppedAtTimeLimit", () => {
  it("reads the backend's deadline message on an unconverged fit only", () => {
    expect(stoppedAtTimeLimit({ success: false, message: "stopped at the 10 s time limit" })).toBe(true);
    expect(stoppedAtTimeLimit({ success: false, message: "max evaluations reached" })).toBe(false);
    expect(stoppedAtTimeLimit({ success: true, message: "converged" })).toBe(false);
    expect(stoppedAtTimeLimit(null)).toBe(false);
  });
});

describe("weakerThanStrongest", () => {
  it("lists the included candidates outside the n tallest, in index order", () => {
    const c = [5, 9, 1, 7, 3].map((height) => ({ height, included: true }));
    expect(weakerThanStrongest(c, 3)).toEqual([2, 4]);
  });
  it("ignores excluded candidates and keeps everything when n covers them", () => {
    const c = [{ height: 9, included: false }, { height: 1, included: true }, { height: 2, included: true }];
    expect(weakerThanStrongest(c, 1)).toEqual([1]);
    expect(weakerThanStrongest(c, 8)).toEqual([]);
  });
});
