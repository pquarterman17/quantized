// The worksheet's numeric cell text. A VSM moment column sits in the
// 1e-3..1e-1 emu band, where a flat 4-decimal fixed format kept only one or
// two significant figures (-0.00136147 emu showed as "-0.0014"), while its
// neighbour just below 1e-3 got four ("-9.990e-4").

import { describe, expect, it } from "vitest";

import { columnFormatter, fmtCell, fmtClockCell, gridFormatters } from "./cellFormat";

describe("fmtCell", () => {
  it("keeps four significant figures for magnitudes in [1e-3, 0.1)", () => {
    expect(fmtCell(-0.00136147092891743)).toBe("-0.001361");
    expect(fmtCell(0.00819218405996633)).toBe("0.008192");
    expect(fmtCell(0.0123456)).toBe("0.01235");
  });

  it("leaves the other bands as they were", () => {
    expect(fmtCell(0.238541007122374)).toBe("0.2385");
    expect(fmtCell(299.903289794922)).toBe("299.9033");
    expect(fmtCell(14999.8989257813)).toBe("1.500e+4");
    expect(fmtCell(-9.300076e-6)).toBe("-9.300e-6");
    expect(fmtCell(0)).toBe("0.0000");
    expect(fmtCell(NaN)).toBe("—");
    expect(fmtCell(undefined)).toBe("—");
  });
});

// Per-column precision: fmtCell's 4 significant figures made a QD
// "Time Stamp (sec)" column read 3.765e+9 on every row. A column whose large
// values collide gets fixed notation with just enough decimals; an integer
// column with large values shows them in full. Everything else is fmtCell.
describe("columnFormatter", () => {
  const fmtCol = (col: (number | undefined)[]) => {
    const f = columnFormatter(col.length, (r) => col[r]);
    return col.map((v) => f(v));
  };

  it("tells QD time stamps apart (fixed, fewest decimals)", () => {
    const stamps = [3764745666.84624, 3764745683.63969, 3764745719.03295];
    expect(stamps.map(fmtCell)).toEqual(["3.765e+9", "3.765e+9", "3.765e+9"]);
    expect(fmtCol(stamps)).toEqual(["3764745667", "3764745684", "3764745719"]);
    expect(fmtCol([3764745666.2, 3764745666.4, NaN])).toEqual(["3764745666.2", "3764745666.4", "—"]);
  });

  it("adds decimals only to the large values of a colliding column", () => {
    expect(fmtCol([70000.12, 70000.34, 5000.25, 0.0123456])).toEqual([
      "70000.1",
      "70000.3",
      "5000.2500",
      "0.01235",
    ]);
  });

  it("shows an integer column with large values in full", () => {
    expect(fmtCol([15000, 23456, 3, 1234567890123, undefined])).toEqual([
      "15000",
      "23456",
      "3",
      "1234567890123",
      "—",
    ]);
  });

  it("caps at 15 significant digits", () => {
    const col = [123456789012345.1, 123456789012345.2];
    expect(fmtCol(col).every((s) => s.replace(/[^0-9]/g, "").length <= 15)).toBe(true);
  });

  it("leaves ordinary, small and non-colliding large columns as fmtCell", () => {
    const cols = [
      [0.238541007122374, 299.903289794922, -0.00136147092891743, 0],
      [-9.300076e-6, -9.300071e-6, 1e-7],
      [14999.8989257813, 25000.5, NaN],
      [2e15, 2e15 + 2],
    ];
    for (const col of cols) expect(fmtCol(col)).toEqual(col.map(fmtCell));
  });

  // UX audit 8 #8: fmtCell picks per cell, so one moment column read
  // "1.553e-5", "1.077e-4" and then "0.001591". A column now takes one notation.
  it("gives a whole column one notation, picked from its magnitude range", () => {
    expect(fmtCol([1.553e-5, 1.077e-4, 0.001591, 0])).toEqual(["1.553e-5", "1.077e-4", "1.591e-3", "0.000e+0"]);
    expect(fmtCol([-69999.83, -12.3, 0, 12.3, 70000.2])).toEqual(["-7.000e+4", "-1.230e+1", "0.000e+0", "1.230e+1", "7.000e+4"]);
    // Fixed where the column reaches 1: its tiny values stay fixed (with fmtCell's figures).
    expect(fmtCol([250.5, 0.00001553, -0.5])).toEqual(["250.5000", "0.00001553", "-0.5000"]);
    expect(fmtCol([0.0016, 0.0012, NaN])).toEqual(["0.001600", "0.001200", "—"]);
    // A fixed column never prints a real tiny value as zero...
    expect(fmtCol([2.5, 1.5e-7])[1]).toBe("0.0000001500");
    // ...but one needing more than ~12 decimals, or spanning > 9 decades, goes exponential.
    expect(fmtCol([5, 3e-25])).toEqual(["5.000e+0", "3.000e-25"]);
    expect(fmtCol([250.5, 1.5e-9])).toEqual(["2.505e+2", "1.500e-9"]);
    expect(fmtCol([0.5, 1e-10])).toEqual(["5.000e-1", "1.000e-10"]);
    // ...and a column whose large values need decimals stays fixed throughout.
    expect(fmtCol([10000.5, 10000.6, 0.00001, 0.5])).toEqual(["10000.5", "10000.6", "0.00001000", "0.5000"]);
  });
});

describe("clock X column", () => {
  it("shows seconds since midnight as HH:MM:SS, display only", () => {
    expect(fmtClockCell(45296)).toBe("12:34:56");
    expect(fmtClockCell(45296.5)).toBe("12:34:56.500");
    expect(fmtClockCell(86400 + 60)).toBe("00:01:00"); // wraps at 24 h
    expect(fmtClockCell(Number.NaN)).toBe("—");
    const time = [45296, 45297];
    expect(gridFormatters(time, [[1], [2]], undefined, "clock")(-1)(time[0])).toBe("12:34:56");
    expect(time).toEqual([45296, 45297]); // stored value untouched
    expect(gridFormatters(time, [[1], [2]])(-1)(45296)).not.toBe("12:34:56"); // y columns / non-clock X unchanged
  });
});
