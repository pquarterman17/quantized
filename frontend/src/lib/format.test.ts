import { afterEach, describe, expect, it } from "vitest";

import { fmtCount, fmtNum, fmtStat, setFormatOpts } from "./format";

// Each test resets to the module defaults (6 sig figs, auto) so order can't bleed.
afterEach(() => setFormatOpts(6, "auto"));

describe("fmtNum (defaults: 6 sig figs, auto)", () => {
  it("trims trailing zeros for ordinary magnitudes", () => {
    expect(fmtNum(3)).toBe("3");
    expect(fmtNum(1234.5678)).toBe("1234.57");
    expect(fmtNum(0)).toBe("0");
    expect(fmtNum(-2.5)).toBe("-2.5");
  });

  it("uses scientific notation for very small/large magnitudes", () => {
    expect(fmtNum(0.0001)).toBe("1.00000e-4");
    expect(fmtNum(1e6)).toBe("1.00000e+6");
  });

  it("returns a dash for non-finite / non-numbers", () => {
    expect(fmtNum(NaN)).toBe("—");
    expect(fmtNum(Infinity)).toBe("—");
    expect(fmtNum(null)).toBe("—");
    expect(fmtNum("x")).toBe("—");
    expect(fmtNum(undefined)).toBe("—");
  });
});

describe("setFormatOpts", () => {
  it("honours a lower sig-figs setting", () => {
    setFormatOpts(3, "auto");
    expect(fmtNum(1234.5678)).toBe("1230"); // 3 sig figs
  });

  it("forces scientific notation for every magnitude", () => {
    setFormatOpts(4, "scientific");
    expect(fmtNum(3)).toBe("3.000e+0");
    expect(fmtNum(1234.5678)).toBe("1.235e+3");
  });

  it("forces fixed-decimal notation", () => {
    setFormatOpts(2, "fixed");
    expect(fmtNum(3)).toBe("3.00");
    expect(fmtNum(1234.5678)).toBe("1234.57");
  });

  it("clamps sig-figs to a sane range", () => {
    setFormatOpts(0, "auto"); // floored to 1
    expect(fmtNum(1234.5678)).toBe("1000");
  });
});

describe("fmtCount (integer quantities ignore the number prefs)", () => {
  it("prints the plain integer under every notation / sig-figs pref", () => {
    for (const [sf, n] of [[3, "scientific"], [3, "fixed"], [1, "auto"], [6, "auto"]] as const) {
      setFormatOpts(sf, n);
      expect(fmtCount(201)).toBe("201");
      expect(fmtCount(0)).toBe("0");
    }
  });

  it("regression: Scientific / 3 sf keeps fmtNum unchanged but counts exact", () => {
    setFormatOpts(3, "scientific");
    expect(fmtNum(201)).toBe("2.01e+2"); // real-value behaviour untouched
    expect(fmtCount(201)).toBe("201");
  });

  it("handles large integers without exponent or grouping", () => {
    setFormatOpts(3, "scientific");
    expect(fmtCount(1234567)).toBe("1234567");
    expect(fmtCount(123456789012)).toBe("123456789012");
    expect(fmtCount(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
  });

  it("dashes non-finite / non-numbers and defers non-integers to fmtNum", () => {
    expect(fmtCount(NaN)).toBe("—");
    expect(fmtCount(null)).toBe("—");
    expect(fmtCount("3")).toBe("—");
    setFormatOpts(3, "auto");
    expect(fmtCount(2.5)).toBe(fmtNum(2.5));
  });

  it("fmtStat routes count keys to fmtCount and others to fmtNum", () => {
    setFormatOpts(3, "scientific");
    expect(fmtStat("N", 201)).toBe("201");
    expect(fmtStat("missing", 12)).toBe("12");
    expect(fmtStat("count", 40)).toBe("40");
    expect(fmtStat("mean", 201)).toBe("2.01e+2");
  });
});
