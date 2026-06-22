import { describe, expect, it } from "vitest";

import { fmtNum } from "./format";

describe("fmtNum", () => {
  it("trims trailing zeros for ordinary magnitudes", () => {
    expect(fmtNum(3)).toBe("3");
    expect(fmtNum(1234.5678)).toBe("1234.57");
    expect(fmtNum(0)).toBe("0");
    expect(fmtNum(-2.5)).toBe("-2.5");
  });

  it("uses scientific notation for very small/large magnitudes", () => {
    expect(fmtNum(0.0001)).toBe("1.0000e-4");
    expect(fmtNum(1e6)).toBe("1.0000e+6");
  });

  it("returns a dash for non-finite / non-numbers", () => {
    expect(fmtNum(NaN)).toBe("—");
    expect(fmtNum(Infinity)).toBe("—");
    expect(fmtNum(null)).toBe("—");
    expect(fmtNum("x")).toBe("—");
    expect(fmtNum(undefined)).toBe("—");
  });
});
