// The worksheet's numeric cell text. A VSM moment column sits in the
// 1e-3..1e-1 emu band, where a flat 4-decimal fixed format kept only one or
// two significant figures (-0.00136147 emu showed as "-0.0014"), while its
// neighbour just below 1e-3 got four ("-9.990e-4").

import { describe, expect, it } from "vitest";

import { fmtCell } from "./cellFormat";

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
