// The worksheet's numeric cell text. A VSM moment column sits in the
// 1e-3..1e-1 emu band, where a flat 4-decimal fixed format kept only one or
// two significant figures (-0.00136147 emu showed as "-0.0014"), while its
// neighbour just below 1e-3 got four ("-9.990e-4").

import { describe, expect, it } from "vitest";

import { columnFormatter, fmtCell } from "./cellFormat";

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
});
