// The per-peak table's value ± error: the SAME rounding Curve Fit's
// "Value ± SE" uses (lib/fitValueFormat.ts), split over two lines so
// value-over-error columns fit the docked 420 px Peak analyzer (UX audit 8
// #5: the table printed "21.7641 ± 3.1" and "0.15083 ± 5.4e-4" while Curve
// Fit printed "(5.94 ± 0.30)×10⁻⁴").

import { describe, expect, it } from "vitest";

import { fmtValueErr } from "../../../lib/fitValueFormat";
import { valueErrCells } from "./ModelFitResults";

describe("valueErrCells", () => {
  it("rounds the value to its error's place (the audit's two cells)", () => {
    expect(valueErrCells(21.7641, 3.1)).toEqual({ value: "21.8", error: "3.1" });
    // 540 leading digits: one significant figure (PDG), as Curve Fit rounds it.
    expect(valueErrCells(0.15083, 5.4e-4)).toEqual({ value: "0.1508", error: "0.0005" });
  });

  it("shares Curve Fit's ×10ⁿ for a very small or large pair", () => {
    expect(valueErrCells(5.94e-4, 3.0e-5)).toEqual({ value: "5.94×10⁻⁴", error: "0.30×10⁻⁴" });
    expect(fmtValueErr(5.94e-4, 3.0e-5)).toBe("(5.94 ± 0.30)×10⁻⁴");
  });

  it("agrees digit for digit with Curve Fit's formatter", () => {
    for (const [v, e] of [[28.40123, 0.00171], [8012.7, 212.78], [1.2345, 0.0123], [-3.3, 0.45]] as const) {
      const c = valueErrCells(v, e);
      expect(`${c.value} ± ${c.error}`).toBe(fmtValueErr(v, e));
    }
  });

  it("without a usable error, the value alone at four figures", () => {
    expect(valueErrCells(28.40123, null)).toEqual({ value: "28.4", error: null });
    expect(valueErrCells(28.4, Number.NaN)).toEqual({ value: "28.4", error: null });
    // A reported error is never hidden, even without a value.
    expect(valueErrCells(null, 0.1)).toEqual({ value: "—", error: "0.1" });
  });
});
