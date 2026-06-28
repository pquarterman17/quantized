import { afterEach, describe, expect, it } from "vitest";

import { fmtNum, setFormatOpts } from "./format";

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
