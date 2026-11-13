// The per-peak table's error formatting: two significant figures (an
// uncertainty's own precision) so value-over-error columns fit the docked
// 420 px Peak Analyzer; the full value stays in the tooltip.

import { describe, expect, it } from "vitest";

import { fmtErr } from "./ModelFitResults";

describe("fmtErr", () => {
  it("rounds a standard error to two significant figures", () => {
    expect(fmtErr(0.0017091)).toBe("0.0017");
    expect(fmtErr(4.40648)).toBe("4.4");
    expect(fmtErr(212.78)).toBe("210");
  });

  it("goes exponential only for very small or large errors", () => {
    expect(fmtErr(0.00012345)).toBe("1.2e-4");
    expect(fmtErr(123456)).toBe("1.2e+5");
    expect(fmtErr(0)).toBe("0");
  });
});
